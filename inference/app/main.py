"""
Inference service — FastAPI entry point.

Startup:
  1. Load all models+scalers from registry.json into memory.
  2. Connect to Postgres and create predictions table (idempotent).
  3. Spawn a background thread that subscribes to Redis 'transactions'.

Per-event hot path:
  - Validate JSON payload.
  - predict() → is_correct, latency_ms.
  - INSERT into Postgres (via thread pool so SSE stays smooth).
  - Push event onto asyncio.Queue → SSE consumers.

Endpoints (per architecture/02-services.md):
  GET  /stream                          SSE live feed
  GET  /metrics?dataset=
  GET  /history?dataset=&limit=
  GET  /registry
  GET  /progress?dataset=
  GET  /models/{dataset}/{model}/export?format=
  POST /control
  POST /reload
  GET  /health
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, List, Optional

import redis as redis_lib
import sqlalchemy as sa
from fastapi import FastAPI, HTTPException, Path as FPath, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from sse_starlette.sse import EventSourceResponse

from .benchmark import run_recorder
from .catalog import (
    fetch_catalog,
    fetch_model_detail,
    fetch_model_last_run,
    fetch_model_runs,
    sync_registry_to_db,
)
from .db import init_db, get_engine, predictions
from .metrics import agg_store, fetch_history, fetch_metrics, fetch_progress
from .model import store as model_store
from .schemas import ControlPayload, HealthResponse, ReloadResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

# ── Config from environment ────────────────────────────────────────────────────
MODELS_DIR = os.environ.get("MODELS_DIR", "/models")
DATA_DIR = os.environ.get("DATA_DIR", "/data")
DATABASE_URL = os.environ.get("DATABASE_URL", "")
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
START_DATASET = os.environ.get("START_DATASET", "fraud")

# ── Globals ────────────────────────────────────────────────────────────────────
_sse_queues: List[asyncio.Queue] = []
_sse_lock = asyncio.Lock()
_thread_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="db-writer")
_redis_client: Optional[redis_lib.Redis] = None
_event_counter: int = 0
_startup_time: float = time.time()

# ── Dataset total row counts (populated at startup) ───────────────────────────
_dataset_total_rows: Dict[str, int] = {}


def _count_csv_rows(data_dir: str) -> Dict[str, int]:
    """Count rows in each dataset's sample.csv (excluding header)."""
    counts: Dict[str, int] = {}
    for slug in ("fraud", "iot", "intrusion"):
        path = Path(data_dir) / slug / "sample.csv"
        if path.exists():
            with path.open() as f:
                # Count lines minus header
                counts[slug] = sum(1 for _ in f) - 1
        else:
            counts[slug] = 0
            logger.warning("sample.csv not found for dataset '%s' at %s", slug, path)
    return counts


# ── Lifespan ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[type-arg]
    global _redis_client, _dataset_total_rows

    # 1. Load models — fail loudly if any file is missing
    model_store.load_all(MODELS_DIR, start_dataset=START_DATASET)

    # 2. Connect to Postgres + create tables (predictions, models, model_runs)
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL env var is required")
    init_db(DATABASE_URL)

    # 3. Sync model registry into DB catalog (T42)
    try:
        sync_registry_to_db(get_engine(), model_store.registry)
    except Exception as exc:
        logger.error("Catalog sync failed at startup: %s", exc)

    # 4. Count CSV rows for /progress
    _dataset_total_rows = _count_csv_rows(DATA_DIR)

    # 5. Redis client (used for control publishes and /monitoring reads)
    _redis_client = redis_lib.from_url(REDIS_URL, decode_responses=True)

    # 6. Subscribe to 'transactions' in a background thread
    loop = asyncio.get_event_loop()
    _thread_pool.submit(_redis_subscriber, loop)

    # 7. Background idle-check: finalize stale benchmark runs every 15 s (T43)
    async def _idle_check_loop() -> None:
        while True:
            await asyncio.sleep(15)
            if run_recorder.is_idle():
                try:
                    await loop.run_in_executor(
                        _thread_pool, run_recorder.finalize_idle, get_engine()
                    )
                except Exception as exc:
                    logger.error("Idle benchmark finalize failed: %s", exc)

    idle_task = asyncio.create_task(_idle_check_loop())

    logger.info("Inference service startup complete")

    yield

    # Shutdown
    idle_task.cancel()
    _thread_pool.shutdown(wait=False)


# ── Application ────────────────────────────────────────────────────────────────
app = FastAPI(title="Inference Service", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Redis subscriber (runs in a background thread) ─────────────────────────────

def _redis_subscriber(loop: asyncio.AbstractEventLoop) -> None:
    """
    Blocking Redis pub/sub loop. Reconnects on failure with backoff.
    Runs in a thread pool so the asyncio event loop is never blocked.
    """
    backoff = 1.0
    while True:
        try:
            r = redis_lib.from_url(REDIS_URL, decode_responses=True)
            pubsub = r.pubsub()
            pubsub.subscribe("transactions")
            logger.info("Subscribed to Redis 'transactions'")
            backoff = 1.0  # reset after successful connect

            for message in pubsub.listen():
                if message["type"] != "message":
                    continue
                _handle_transaction(message["data"], loop)

        except Exception as exc:
            logger.error("Redis subscriber error: %s — reconnecting in %.1fs", exc, backoff)
            time.sleep(backoff)
            backoff = min(backoff * 2, 30.0)


def _handle_transaction(raw: str, loop: asyncio.AbstractEventLoop) -> None:
    """
    Parse and process one transaction message.
    Validates structure before any processing (security: never eval).
    """
    global _event_counter
    received_at = datetime.now(timezone.utc)

    # ── 1. Parse + validate ────────────────────────────────────────────────────
    try:
        payload: Dict[str, Any] = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        logger.warning("Skipping malformed message (not JSON): %.120s", raw)
        return

    dataset = payload.get("dataset")
    features = payload.get("features")
    actual = payload.get("actual")

    if not isinstance(dataset, str) or dataset not in {"fraud", "iot", "intrusion"}:
        logger.warning("Skipping message with invalid dataset: %s", dataset)
        return
    if not isinstance(features, dict) or not features:
        logger.warning("Skipping message with missing/empty features")
        return
    if actual not in (0, 1):
        logger.warning("Skipping message with invalid actual label: %s", actual)
        return

    # ── 2. Select active model ─────────────────────────────────────────────────
    active_dataset = model_store.active_dataset
    active_model = model_store.active_model

    # Use the message dataset (the model for that dataset), not necessarily the
    # UI-selected dataset — messages may come from the streamer's current dataset
    predict_dataset = dataset
    # Pick the active model slug for this dataset
    models_for_ds = model_store.known_models(predict_dataset)
    if not models_for_ds:
        logger.warning("No model loaded for dataset '%s' — skipping", predict_dataset)
        return
    # Use the UI-active model if it belongs to this dataset, else first available
    if active_dataset == predict_dataset and active_model in models_for_ds:
        model_slug = active_model
    else:
        model_slug = next(iter(sorted(models_for_ds)))

    # ── 3. Predict ─────────────────────────────────────────────────────────────
    try:
        label, probability = model_store.predict(predict_dataset, model_slug, features)
    except Exception as exc:
        logger.warning("Prediction failed for (%s, %s): %s", predict_dataset, model_slug, exc)
        return

    processed_at = datetime.now(timezone.utc)
    latency_ms = (processed_at - received_at).total_seconds() * 1000.0
    is_correct = label == int(actual)
    is_positive = label == 1

    # ── 4. Update in-memory aggregates ────────────────────────────────────────
    agg_store.record(predict_dataset, is_correct, is_positive, latency_ms)
    agg = agg_store.snapshot(predict_dataset)

    # ── 4b. Update benchmark accumulator for the active model (T43) ───────────
    run_recorder.update(predict_dataset, model_slug, is_correct, label, int(actual), latency_ms)

    # ── 5. Persist to Postgres (off event loop) ────────────────────────────────
    _thread_pool.submit(
        _db_insert,
        predict_dataset,
        model_slug,
        received_at,
        processed_at,
        latency_ms,
        label,
        int(actual),
        is_correct,
        probability,
        features,
    )

    # ── 6. Build SSE event and push to all SSE consumers ──────────────────────
    _event_counter += 1
    event = {
        "id": _event_counter,
        "dataset": predict_dataset,
        "prediction": label,
        "actual": int(actual),
        "is_correct": is_correct,
        "probability": round(probability, 6),
        "latency_ms": round(latency_ms, 3),
        "ts": processed_at.isoformat(),
        "running_accuracy": agg["running_accuracy"],
        "total_processed": agg["total"],
        "positive_count": agg["positive_count"],
        "throughput": agg["throughput"],
        "avg_latency": agg["avg_latency"],
    }
    asyncio.run_coroutine_threadsafe(_broadcast_sse(event), loop)


async def _broadcast_sse(event: Dict[str, Any]) -> None:
    """Push event onto every active SSE queue."""
    async with _sse_lock:
        queues = list(_sse_queues)
    for q in queues:
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass  # slow consumer — skip rather than block


def _db_insert(
    dataset: str,
    model_slug: str,
    received_at: datetime,
    processed_at: datetime,
    latency_ms: float,
    prediction: int,
    actual_label: int,
    is_correct: bool,
    probability: float,
    features: Dict[str, Any],
) -> None:
    """Parameterized INSERT — runs in the thread pool, never blocks the event loop."""
    try:
        engine = get_engine()
        with engine.begin() as conn:
            conn.execute(
                predictions.insert(),
                {
                    "dataset": dataset,
                    "model_name": model_slug,
                    "received_at": received_at,
                    "processed_at": processed_at,
                    "latency_ms": latency_ms,
                    "prediction": prediction,
                    "actual_label": actual_label,
                    "is_correct": is_correct,
                    "probability": probability,
                    "payload": features,
                },
            )
    except Exception as exc:
        logger.error("DB insert failed: %s", exc)


# ── Endpoints ──────────────────────────────────────────────────────────────────

@app.get("/stream")
async def stream(request: Request) -> EventSourceResponse:
    """SSE — live prediction events with running aggregates."""

    async def generator() -> AsyncGenerator[Dict[str, Any], None]:
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        async with _sse_lock:
            _sse_queues.append(q)
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(q.get(), timeout=15.0)
                    yield {"data": json.dumps(event)}
                except asyncio.TimeoutError:
                    # Heartbeat to keep the connection alive
                    yield {"comment": "heartbeat"}
        finally:
            async with _sse_lock:
                try:
                    _sse_queues.remove(q)
                except ValueError:
                    pass

    return EventSourceResponse(generator())


@app.get("/metrics")
async def metrics(dataset: str = Query(..., pattern="^(fraud|iot|intrusion)$")) -> Dict[str, Any]:
    """DB-backed accuracy, confusion matrix, latency, throughput."""
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        _thread_pool, fetch_metrics, get_engine(), dataset
    )
    return result


@app.get("/history")
async def history(
    dataset: str = Query(..., pattern="^(fraud|iot|intrusion)$"),
    limit: int = Query(50, ge=1, le=1000),
) -> List[Dict[str, Any]]:
    """Recent prediction rows from Postgres."""
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        _thread_pool, fetch_history, get_engine(), dataset, limit
    )
    return result


@app.get("/registry")
async def registry() -> Dict[str, Any]:
    """Serve the full model registry (for the dashboard settings popup)."""
    reg = model_store.registry
    # Annotate with current active selection
    return {
        "registry": reg,
        "active_dataset": model_store.active_dataset,
        "active_model": model_store.active_model,
    }


@app.get("/progress")
async def progress(dataset: str = Query(..., pattern="^(fraud|iot|intrusion)$")) -> Dict[str, Any]:
    """rows_processed / total_rows / percent for dataset progress widget."""
    total = _dataset_total_rows.get(dataset, 0)
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        _thread_pool, fetch_progress, get_engine(), dataset, total
    )
    return result


# ── Model export ───────────────────────────────────────────────────────────────

# Allowed format values — whitelist to prevent injection
_ALLOWED_FORMATS = {"joblib", "pickle", "onnx", "pmml"}
# Safe slug pattern (no path traversal)
_SAFE_SLUG = re.compile(r"^[a-z0-9][a-z0-9\-]{1,63}$")


@app.get("/models/{dataset}/{model}/export")
async def export_model(
    dataset: str = FPath(..., pattern="^(fraud|iot|intrusion)$"),
    model: str = FPath(...),
    format: str = Query(...),
) -> FileResponse:
    """Stream a pre-generated model file as a download attachment."""
    # Validate format
    if format not in _ALLOWED_FORMATS:
        raise HTTPException(status_code=400, detail=f"Unknown format '{format}'. Allowed: {_ALLOWED_FORMATS}")

    # Validate model slug — no path traversal
    if not _SAFE_SLUG.match(model):
        raise HTTPException(status_code=400, detail="Invalid model slug")

    meta = model_store.get_model_meta(dataset, model)
    if meta is None:
        raise HTTPException(status_code=404, detail=f"Model ({dataset}, {model}) not found in registry")

    filename = meta.get("formats", {}).get(format)
    if not filename:
        raise HTTPException(status_code=404, detail=f"Format '{format}' not available for this model")

    # Resolve and sanitise path — must stay inside MODELS_DIR/<dataset>/
    models_base = Path(MODELS_DIR).resolve()
    file_path = (models_base / dataset / filename).resolve()

    # Prevent directory traversal: resolved path must be under models_base/dataset
    allowed_parent = (models_base / dataset).resolve()
    if not str(file_path).startswith(str(allowed_parent) + "/") and file_path != allowed_parent:
        raise HTTPException(status_code=400, detail="Path traversal not allowed")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"Export file not found on disk: {filename}")

    # Map format to MIME type
    media_type_map = {
        "joblib": "application/octet-stream",
        "pickle": "application/octet-stream",
        "onnx": "application/octet-stream",
        "pmml": "application/xml",
    }
    return FileResponse(
        path=str(file_path),
        media_type=media_type_map.get(format, "application/octet-stream"),
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Model catalog endpoints (T42) ─────────────────────────────────────────────
# IMPORTANT: The /export route above uses a fixed suffix (/models/{ds}/{model}/export)
# and is registered first. FastAPI matches fixed-suffix paths before generic ones, so
# /models/{dataset}/{slug}/export resolves correctly and the routes below do NOT shadow it.

@app.get("/models")
async def list_models(
    dataset: Optional[str] = Query(None, pattern="^(fraud|iot|intrusion)$"),
) -> List[Dict[str, Any]]:
    """Catalog of all known models with each model's last-run summary."""
    loop = asyncio.get_event_loop()
    try:
        return await loop.run_in_executor(_thread_pool, fetch_catalog, get_engine(), dataset)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/models/{dataset}/{slug}/runs")
async def model_runs(
    dataset: str = FPath(..., pattern="^(fraud|iot|intrusion)$"),
    slug: str = FPath(...),
) -> List[Dict[str, Any]]:
    """All benchmark runs for a model, most recent first."""
    loop = asyncio.get_event_loop()
    try:
        return await loop.run_in_executor(
            _thread_pool, fetch_model_runs, get_engine(), dataset, slug
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/models/{dataset}/{slug}/last-run")
async def model_last_run(
    dataset: str = FPath(..., pattern="^(fraud|iot|intrusion)$"),
    slug: str = FPath(...),
) -> Dict[str, Any]:
    """The most-recently finalized benchmark run (is_last=true), or null."""
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            _thread_pool, fetch_model_last_run, get_engine(), dataset, slug
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"run": result}


@app.get("/models/{dataset}/{slug}/current-run")
async def model_current_run(
    dataset: str = FPath(..., pattern="^(fraud|iot|intrusion)$"),
    slug: str = FPath(...),
) -> Dict[str, Any]:
    """Live accumulator snapshot for the active model (T43). Returns null if not active."""
    if not _SAFE_SLUG.match(slug):
        raise HTTPException(status_code=400, detail="Invalid model slug")
    snapshot = run_recorder.current_snapshot(dataset, slug)
    return {"current_run": snapshot}


@app.get("/models/{dataset}/{slug}")
async def model_detail(
    dataset: str = FPath(..., pattern="^(fraud|iot|intrusion)$"),
    slug: str = FPath(...),
) -> Dict[str, Any]:
    """Full detail for one model from the catalog."""
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            _thread_pool, fetch_model_detail, get_engine(), dataset, slug
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if result is None:
        raise HTTPException(status_code=404, detail=f"Model ({dataset}, {slug}) not found")
    return result


# ── Monitoring aggregator (T46) ────────────────────────────────────────────────

@app.get("/monitoring")
async def monitoring() -> Dict[str, Any]:
    """
    Aggregate health and stats from all backend services.
    Tolerates individual service failures — never returns 500 due to a downstream error.
    """
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(_thread_pool, _collect_monitoring)
    return result


def _collect_monitoring() -> Dict[str, Any]:
    """Synchronous collection of all monitoring sections. Runs in thread pool."""
    return {
        "postgres": _mon_postgres(),
        "redis": _mon_redis(),
        "streamer": _mon_streamer(),
        "inference": _mon_inference(),
    }


def _mon_postgres() -> Dict[str, Any]:
    try:
        engine = get_engine()
        with engine.connect() as conn:
            # DB size in MB
            size_row = conn.execute(
                sa.text("SELECT pg_database_size(current_database()) AS sz")
            ).fetchone()
            db_size_mb = round(float(size_row.sz) / 1_048_576, 2) if size_row else 0.0

            # Predictions total + by dataset (parameterized — no user input here)
            total_row = conn.execute(
                sa.text("SELECT COUNT(*) AS cnt FROM predictions")
            ).fetchone()
            predictions_total = int(total_row.cnt) if total_row else 0

            by_ds_rows = conn.execute(
                sa.text(
                    """
                    SELECT dataset, COUNT(*) AS cnt
                    FROM predictions
                    GROUP BY dataset
                    ORDER BY dataset
                    """
                )
            ).fetchall()
            predictions_by_dataset = {r.dataset: int(r.cnt) for r in by_ds_rows}

            # Active connections (pg_stat_activity)
            conn_row = conn.execute(
                sa.text(
                    "SELECT COUNT(*) AS cnt FROM pg_stat_activity WHERE state IS NOT NULL"
                )
            ).fetchone()
            connections = int(conn_row.cnt) if conn_row else 0

        return {
            "status": "ok",
            "db_size_mb": db_size_mb,
            "predictions_total": predictions_total,
            "predictions_by_dataset": predictions_by_dataset,
            "connections": connections,
        }
    except Exception as exc:
        logger.warning("Monitoring: postgres probe failed: %s", exc)
        return {"status": "down", "error": str(exc)}


def _mon_redis() -> Dict[str, Any]:
    try:
        if _redis_client is None:
            return {"status": "down", "error": "client not initialised"}

        info = _redis_client.info()
        # pubsub_numsub returns either a dict or a list of (channel, count) pairs
        # depending on redis-py version; normalise to dict
        raw_pubsub = _redis_client.pubsub_numsub("transactions", "control")
        if isinstance(raw_pubsub, dict):
            pubsub_map = raw_pubsub
        else:
            # list of alternating [channel, count, channel, count, ...]
            # or list of tuples [(channel, count), ...]
            pubsub_map: Dict[str, int] = {}
            it = iter(raw_pubsub)
            for item in it:
                if isinstance(item, (list, tuple)):
                    pubsub_map[str(item[0])] = int(item[1])
                else:
                    # alternating strings/ints
                    try:
                        pubsub_map[str(item)] = int(next(it))
                    except StopIteration:
                        break

        return {
            "status": "ok",
            "version": info.get("redis_version", "unknown"),
            "used_memory_mb": round(info.get("used_memory", 0) / 1_048_576, 2),
            "connected_clients": info.get("connected_clients", 0),
            "ops_per_sec": info.get("instantaneous_ops_per_sec", 0),
            "pubsub": {
                "transactions": pubsub_map.get("transactions", 0),
                "control": pubsub_map.get("control", 0),
            },
        }
    except Exception as exc:
        logger.warning("Monitoring: redis probe failed: %s", exc)
        return {"status": "down", "error": str(exc)}


def _mon_streamer() -> Dict[str, Any]:
    """
    Read streamer:heartbeat from Redis.
    Returns status=down/unknown if key is absent or ts is stale (>6 s).
    T45 (streamer heartbeat task) will populate this key.
    """
    try:
        if _redis_client is None:
            return {"status": "unknown", "reason": "redis not available"}

        raw = _redis_client.get("streamer:heartbeat")
        if raw is None:
            return {"status": "down", "reason": "streamer not running (no heartbeat)"}

        hb: Dict[str, Any] = json.loads(raw)
        ts_val = hb.get("ts")
        if ts_val is None:
            return {"status": "unknown", "reason": "heartbeat missing ts field"}

        # Parse ISO timestamp
        hb_time = datetime.fromisoformat(str(ts_val).replace("Z", "+00:00"))
        age_s = (datetime.now(timezone.utc) - hb_time).total_seconds()
        if age_s > 6:
            return {
                "status": "down",
                "reason": f"heartbeat stale ({age_s:.1f}s old)",
                **{k: v for k, v in hb.items() if k != "ts"},
                "ts": ts_val,
                "age_s": round(age_s, 1),
            }

        return {
            "status": "ok",
            "dataset": hb.get("dataset"),
            "paused": hb.get("paused"),
            "interval_ms": hb.get("interval_ms"),
            "messages_sent": hb.get("messages_sent"),
            "rate": hb.get("rate"),
            "uptime_s": hb.get("uptime_s"),
            "ts": ts_val,
            "age_s": round(age_s, 1),
        }
    except Exception as exc:
        logger.warning("Monitoring: streamer probe failed: %s", exc)
        return {"status": "unknown", "error": str(exc)}


def _mon_inference() -> Dict[str, Any]:
    agg = agg_store.snapshot(model_store.active_dataset)
    sse_count: int
    # _sse_queues is an asyncio list; read its length without locking (it's append-only)
    try:
        sse_count = len(_sse_queues)
    except Exception:
        sse_count = 0

    return {
        "status": "ok",
        "models_loaded": model_store.models_loaded_count(),
        "active_dataset": model_store.active_dataset,
        "active_model": model_store.active_model,
        "throughput": agg["throughput"],
        "avg_latency_ms": agg["avg_latency"],
        "sse_subscribers": sse_count,
        "uptime_s": round(time.time() - _startup_time, 1),
    }


# ── Control ────────────────────────────────────────────────────────────────────

@app.post("/control")
async def control(payload: ControlPayload) -> Dict[str, Any]:
    """
    Apply dataset/model switch locally and relay the full command to Redis 'control'.
    Validates inputs before touching any state.
    Finalizes the current benchmark run when the active model changes (T43).
    """
    # Validate model if provided
    if payload.model is not None:
        ds = payload.dataset or model_store.active_dataset
        if payload.model not in model_store.known_models(ds):
            raise HTTPException(
                status_code=400,
                detail=f"Unknown model '{payload.model}' for dataset '{ds}'",
            )

    # Capture previous active key before the switch (T43)
    prev_dataset = model_store.active_dataset
    prev_model = model_store.active_model

    # Apply locally
    try:
        model_store.set_active(payload.dataset, payload.model)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    new_dataset = model_store.active_dataset
    new_model = model_store.active_model

    # If the active (dataset, model) changed, finalize the previous benchmark run (T43)
    if (prev_dataset, prev_model) != (new_dataset, new_model):
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            _thread_pool,
            run_recorder.finalize_and_reset,
            get_engine(),
            new_dataset,
            new_model,
        )

    # Publish to Redis 'control' channel (streamer listens here)
    command: Dict[str, Any] = {}
    if payload.interval_ms is not None:
        command["interval_ms"] = payload.interval_ms
    if payload.paused is not None:
        command["paused"] = payload.paused
    if payload.dataset is not None:
        command["dataset"] = payload.dataset
    if payload.model is not None:
        command["model"] = payload.model

    if _redis_client and command:
        try:
            _redis_client.publish("control", json.dumps(command))
        except Exception as exc:
            logger.error("Failed to publish to Redis control channel: %s", exc)

    return {
        "status": "ok",
        "active_dataset": model_store.active_dataset,
        "active_model": model_store.active_model,
        "command_published": command,
    }


# ── Reload ─────────────────────────────────────────────────────────────────────

@app.post("/reload")
async def reload() -> ReloadResponse:
    """
    Hot-reload: re-read registry.json and joblib.load any new/changed models.
    Thread-safe — the prediction hot path is unaffected.
    Also re-syncs the model catalog to DB (T42).
    """
    loop = asyncio.get_event_loop()
    try:
        count = await loop.run_in_executor(_thread_pool, model_store.reload)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Reload failed: {exc}")

    # Re-sync catalog after registry changes (T42)
    try:
        await loop.run_in_executor(
            _thread_pool, sync_registry_to_db, get_engine(), model_store.registry
        )
    except Exception as exc:
        logger.error("Catalog sync after reload failed: %s", exc)

    return ReloadResponse(
        status="ok",
        models_loaded=count,
        registry_summary={
            "datasets": list(model_store.registry.keys()),
            "active_dataset": model_store.active_dataset,
            "active_model": model_store.active_model,
        },
    )


# ── Health ─────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health() -> HealthResponse:
    # DB probe
    db_status = "ok"
    try:
        engine = get_engine()
        with engine.connect() as conn:
            conn.execute(sa.text("SELECT 1"))
    except Exception as exc:
        db_status = f"error: {exc}"

    # Redis probe
    redis_status = "ok"
    try:
        if _redis_client:
            _redis_client.ping()
        else:
            redis_status = "not connected"
    except Exception as exc:
        redis_status = f"error: {exc}"

    return HealthResponse(
        status="ok" if db_status == "ok" and redis_status == "ok" else "degraded",
        db=db_status,
        redis=redis_status,
        models_loaded=model_store.models_loaded_count(),
        active_dataset=model_store.active_dataset,
        active_model=model_store.active_model,
    )
