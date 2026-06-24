"""
Trainer service — FastAPI entry point.

Endpoints:
  GET  /health
  GET  /algos
  GET  /stats           {active_jobs, last_trained, uptime_s}
  POST /train           {dataset, algo, name, train_fraction} -> {job_id}
  GET  /train/stream    ?job_id=<uuid>  -> SSE progress stream

The training job runs in a ThreadPoolExecutor so the API stays responsive.
Progress is pushed onto the job's event queue; the SSE generator reads it out.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, AsyncGenerator

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from sse_starlette.sse import EventSourceResponse

from .config import ALGOS, MODELS_DIR, DATA_DIR, INFERENCE_URL, VALID_DATASETS, VALID_ALGOS
from .jobs import TrainingJob, create_job, get_job, list_jobs
from .training import run_training_job, slugify

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Thread pool for background training jobs
# (training is CPU-bound; one job at a time is fine for the demo)
# ---------------------------------------------------------------------------
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="trainer")
_start_time = time.monotonic()

# Last-trained summary — updated after each successful job (thread-safe write, single field)
_last_trained: dict[str, Any] | None = None

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(title="Trainer Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request schema
# ---------------------------------------------------------------------------

class TrainRequest(BaseModel):
    dataset: str
    algo: str
    name: str
    train_fraction: float = 0.7

    @field_validator("dataset")
    @classmethod
    def validate_dataset(cls, v: str) -> str:
        if v not in VALID_DATASETS:
            raise ValueError(f"dataset must be one of {sorted(VALID_DATASETS)}")
        return v

    @field_validator("algo")
    @classmethod
    def validate_algo(cls, v: str) -> str:
        if v not in VALID_ALGOS:
            raise ValueError(f"algo must be one of {sorted(VALID_ALGOS)}")
        return v

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be empty")
        if len(v) > 80:
            raise ValueError("name must be 80 characters or fewer")
        return v

    @field_validator("train_fraction")
    @classmethod
    def validate_train_fraction(cls, v: float) -> float:
        if not (0.05 <= v <= 1.0):
            raise ValueError("train_fraction must be between 0.05 and 1.0 inclusive")
        return v


# ---------------------------------------------------------------------------
# Background job runner (executed inside ThreadPoolExecutor)
# ---------------------------------------------------------------------------

def _run_job_in_thread(job: TrainingJob) -> None:
    """Execute a training job synchronously in a worker thread."""
    global _last_trained
    job.status = "running"

    def emit(payload: dict[str, Any]) -> None:
        job.add_event(payload)

    try:
        result = run_training_job(
            dataset=job.dataset,
            algo=job.algo,
            name=job.name,
            emit=emit,
            models_dir=MODELS_DIR,
            data_dir=DATA_DIR,
            inference_url=INFERENCE_URL,
            train_fraction=job.train_fraction,
        )
        job.status = "done"
        emit(result)  # final event with status="done"
        # Update last-trained summary for /stats
        import time as _time
        _last_trained = {
            "slug": result.get("slug"),
            "dataset": result.get("dataset"),
            "accuracy": result.get("accuracy"),
            "train_fraction": result.get("train_fraction"),
            "ts": _time.strftime("%Y-%m-%dT%H:%M:%SZ", _time.gmtime()),
        }
    except Exception as exc:
        logger.exception("Training job %s failed: %s", job.job_id, exc)
        job.status = "error"
        job.error = str(exc)
        emit({"status": "error", "error": str(exc)})


# ---------------------------------------------------------------------------
# SSE generator
# ---------------------------------------------------------------------------

async def _sse_generator(job: TrainingJob) -> AsyncGenerator[dict[str, str], None]:
    """Yield SSE events for a training job, waiting for new events as they arrive."""
    cursor = 0  # index into job.events already sent

    while True:
        # Drain any events that have arrived since last iteration
        while cursor < len(job.events):
            payload = job.events[cursor]
            cursor += 1
            yield {"data": json.dumps(payload)}
            # If this is the terminal event, stop
            if payload.get("status") in ("done", "error"):
                return

        # If job is finished and we've drained all events, stop
        if job.status in ("done", "error") and cursor >= len(job.events):
            return

        # Wait for a new event to arrive (with a timeout to poll for job completion)
        job._event.clear()
        try:
            await asyncio.wait_for(job._event.wait(), timeout=1.0)
        except asyncio.TimeoutError:
            pass  # re-check loop condition


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/algos")
async def algos() -> list[dict[str, str]]:
    return ALGOS


@app.get("/stats")
async def stats() -> dict[str, Any]:
    """Return trainer service stats: active_jobs, last_trained, uptime_s."""
    jobs = list_jobs()
    active = sum(1 for j in jobs if j.status in ("queued", "running"))
    return {
        "active_jobs": active,
        "last_trained": _last_trained,
        "uptime_s": round(time.monotonic() - _start_time, 1),
    }


@app.post("/train", status_code=202)
async def start_training(req: TrainRequest) -> dict[str, str]:
    """Start a background training job. Returns {job_id}."""
    job = create_job(
        dataset=req.dataset,
        algo=req.algo,
        name=req.name,
        train_fraction=req.train_fraction,
    )
    logger.info(
        "Created job %s: dataset=%s algo=%s name=%r train_fraction=%.2f",
        job.job_id, job.dataset, job.algo, job.name, job.train_fraction,
    )

    # Submit to thread pool — non-blocking from the event loop's perspective
    loop = asyncio.get_event_loop()
    loop.run_in_executor(_executor, _run_job_in_thread, job)

    return {"job_id": job.job_id}


@app.get("/train/stream")
async def stream_training(job_id: str = Query(..., description="Job ID from POST /train")) -> EventSourceResponse:
    """SSE stream for a training job. Emits progress events then a final done/error event."""
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id!r}")

    return EventSourceResponse(_sse_generator(job))
