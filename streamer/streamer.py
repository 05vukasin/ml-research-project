"""
streamer.py — Replays dataset CSVs to Redis `transactions` at a controllable rate.

Env vars:
  REDIS_URL          Redis connection URL            (default: redis://localhost:6379)
  DATA_DIR           Root dir containing <slug>/     (default: /data)
  START_DATASET      Initial dataset slug            (default: fraud)
  START_INTERVAL_MS  Initial publish interval in ms  (default: 500)

Redis channels:
  transactions  OUT  {dataset, features, actual}
  control       IN   {interval_ms?, paused?, dataset?}

Redis keys:
  streamer:heartbeat  STRING  JSON {dataset, paused, interval_ms, messages_sent, rate,
                                    uptime_s, ts}  written every ~2s with TTL=6s
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import redis

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("streamer")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
REDIS_URL: str = os.environ.get("REDIS_URL", "redis://localhost:6379")
DATA_DIR: Path = Path(os.environ.get("DATA_DIR", "/data"))
START_DATASET: str = os.environ.get("START_DATASET", "fraud")
START_INTERVAL_MS: int = int(os.environ.get("START_INTERVAL_MS", "500"))

# Known dataset slugs — guard against arbitrary input on `control`.
KNOWN_SLUGS: frozenset[str] = frozenset({"fraud", "iot", "intrusion"})

# ---------------------------------------------------------------------------
# Shared mutable state (protected by a lock)
# ---------------------------------------------------------------------------
_lock = threading.Lock()
_state: dict[str, Any] = {
    "interval_ms": START_INTERVAL_MS,
    "paused": False,
    "dataset": START_DATASET,        # current slug
    "switch_requested": False,       # signals main loop to reload CSV
    # Heartbeat stats (written by publish loop, read by heartbeat thread)
    "messages_sent": 0,              # total rows published since start
    "rate": 0.0,                     # rolling msg/s (updated every 100 messages)
    "uptime_start": time.monotonic(), # set once at startup
}


# ---------------------------------------------------------------------------
# Dataset helpers
# ---------------------------------------------------------------------------

def csv_path(dataset: str) -> Path:
    return DATA_DIR / dataset / "sample.csv"


def load_dataset(dataset: str) -> tuple[pd.DataFrame, list[str], str]:
    """Load CSV for *dataset*; derive feature columns and label column.

    The label column is the CSV column that is NOT listed as a model feature in
    registry.json.  Falls back to detecting it as the single non-feature column.

    Returns (dataframe, feature_cols, label_col).
    Raises FileNotFoundError / ValueError on bad input.
    """
    path = csv_path(dataset)
    if not path.exists():
        raise FileNotFoundError(f"CSV not found: {path}")

    df = pd.read_csv(path)
    if df.empty:
        raise ValueError(f"CSV is empty: {path}")

    # Load feature list from registry.json (sibling of DATA_DIR at project root).
    registry_path = DATA_DIR.parent / "models" / "registry.json"
    features: list[str] = []
    if registry_path.exists():
        try:
            registry = json.loads(registry_path.read_text())
            entry = registry.get(dataset, {})
            models = entry.get("models", [])
            if models:
                features = [f.lower() for f in models[0].get("features", [])]
        except Exception as exc:  # noqa: BLE001
            log.warning("Could not read registry.json: %s", exc)

    csv_cols_lower = [c.lower() for c in df.columns]
    df.columns = csv_cols_lower  # normalise to lowercase

    if features:
        label_candidates = [c for c in csv_cols_lower if c not in features]
        if len(label_candidates) != 1:
            raise ValueError(
                f"Expected exactly 1 label column for {dataset}, "
                f"got {label_candidates} (features={features}, csv={csv_cols_lower})"
            )
        label_col = label_candidates[0]
        feature_cols = features
    else:
        # Fallback: last column is the label.
        label_col = csv_cols_lower[-1]
        feature_cols = csv_cols_lower[:-1]
        log.warning(
            "No registry entry for %s — assuming label=%s, features=%s",
            dataset, label_col, feature_cols,
        )

    # Verify all expected columns are present.
    missing = [f for f in feature_cols if f not in csv_cols_lower]
    if missing:
        raise ValueError(f"Missing feature columns in CSV for {dataset}: {missing}")

    log.info(
        "Loaded dataset=%s rows=%d features=%s label=%s",
        dataset, len(df), feature_cols, label_col,
    )
    return df, feature_cols, label_col


# ---------------------------------------------------------------------------
# Redis helpers
# ---------------------------------------------------------------------------

def connect_redis(url: str) -> redis.Redis:
    """Return a connected Redis client, retrying with backoff."""
    backoff = 1.0
    while True:
        try:
            client = redis.Redis.from_url(url, decode_responses=True)
            client.ping()
            log.info("Connected to Redis at %s", url)
            return client
        except redis.RedisError as exc:
            log.error("Redis connection failed (%s) — retrying in %.0fs", exc, backoff)
            time.sleep(backoff)
            backoff = min(backoff * 2, 30.0)


def build_message(dataset: str, row: pd.Series, feature_cols: list[str], label_col: str) -> str:
    """Serialise one CSV row into a JSON transactions payload."""
    features = {col: row[col] for col in feature_cols}
    # Coerce numpy scalars to plain Python types.
    features = {k: (int(v) if isinstance(v, (int,)) else float(v) if hasattr(v, "__float__") else v)
                for k, v in features.items()}
    actual = int(row[label_col])
    payload = {"dataset": dataset, "features": features, "actual": actual}
    return json.dumps(payload)


# ---------------------------------------------------------------------------
# Heartbeat writer thread
# ---------------------------------------------------------------------------

# TTL must be longer than the write interval so the key never goes stale while the
# streamer is alive.  6 s > 2 s cadence; /monitoring treats age > 6 s as "down".
_HEARTBEAT_KEY = "streamer:heartbeat"
_HEARTBEAT_TTL_S = 6
_HEARTBEAT_INTERVAL_S = 2.0


def heartbeat_writer(redis_url: str) -> None:
    """Daemon thread: write a fresh JSON heartbeat to Redis every ~2 s.

    Uses a dedicated Redis connection so a publish-loop reconnect doesn't race
    with the heartbeat write.  Never raises — Redis errors are logged and retried
    on the next tick.
    """
    r: redis.Redis | None = None

    while True:
        try:
            if r is None:
                r = connect_redis(redis_url)

            with _lock:
                dataset = _state["dataset"]
                paused = _state["paused"]
                interval_ms = _state["interval_ms"]
                messages_sent = _state["messages_sent"]
                rate = _state["rate"]
                uptime_start = _state["uptime_start"]

            uptime_s = round(time.monotonic() - uptime_start, 1)
            ts = datetime.now(timezone.utc).isoformat()

            payload = json.dumps({
                "dataset": dataset,
                "paused": paused,
                "interval_ms": interval_ms,
                "messages_sent": messages_sent,
                "rate": round(rate, 2),
                "uptime_s": uptime_s,
                "ts": ts,
            })

            r.set(_HEARTBEAT_KEY, payload, ex=_HEARTBEAT_TTL_S)

        except redis.RedisError as exc:
            log.warning("Heartbeat write failed (%s) — will reconnect", exc)
            r = None  # force reconnect on next tick

        except Exception as exc:  # noqa: BLE001
            log.warning("Heartbeat unexpected error: %s", exc)

        time.sleep(_HEARTBEAT_INTERVAL_S)


# ---------------------------------------------------------------------------
# Control subscriber thread
# ---------------------------------------------------------------------------

def control_subscriber(redis_url: str) -> None:
    """Background thread: subscribe to `control` and update shared state."""
    while True:
        try:
            client = connect_redis(redis_url)
            pubsub = client.pubsub()
            pubsub.subscribe("control")
            log.info("Control subscriber ready on channel 'control'")
            for message in pubsub.listen():
                if message["type"] != "message":
                    continue
                try:
                    cmd: dict = json.loads(message["data"])
                except (json.JSONDecodeError, TypeError) as exc:
                    log.warning("Malformed control message (skipped): %s — %s", message["data"], exc)
                    continue

                with _lock:
                    if "interval_ms" in cmd:
                        val = cmd["interval_ms"]
                        if isinstance(val, (int, float)) and val > 0:
                            _state["interval_ms"] = int(val)
                            log.info("interval_ms -> %d", _state["interval_ms"])
                        else:
                            log.warning("Invalid interval_ms value: %s", val)

                    if "paused" in cmd:
                        _state["paused"] = bool(cmd["paused"])
                        log.info("paused -> %s", _state["paused"])

                    if "dataset" in cmd:
                        slug = str(cmd["dataset"]).lower()
                        if slug not in KNOWN_SLUGS:
                            log.warning("Unknown dataset slug '%s' — ignored", slug)
                        elif slug != _state["dataset"]:
                            _state["dataset"] = slug
                            _state["switch_requested"] = True
                            log.info("Dataset switch requested -> %s", slug)

        except redis.RedisError as exc:
            log.error("Control subscriber lost Redis connection (%s) — reconnecting", exc)
            time.sleep(2)


# ---------------------------------------------------------------------------
# Main publish loop
# ---------------------------------------------------------------------------

def publish_loop() -> None:
    """Main loop: load CSV, iterate rows, publish to `transactions`."""
    r = connect_redis(REDIS_URL)

    current_dataset = START_DATASET
    df, feature_cols, label_col = load_dataset(current_dataset)
    row_count = len(df)
    idx = 0

    published = 0
    window_start = time.monotonic()

    while True:
        # Check for dataset switch.
        with _lock:
            switch = _state.get("switch_requested", False)
            new_dataset = _state["dataset"]

        if switch or new_dataset != current_dataset:
            try:
                df, feature_cols, label_col = load_dataset(new_dataset)
                current_dataset = new_dataset
                row_count = len(df)
                idx = 0
                with _lock:
                    _state["switch_requested"] = False
                log.info("Switched to dataset=%s", current_dataset)
            except (FileNotFoundError, ValueError) as exc:
                log.error("Failed to load dataset '%s': %s — continuing with '%s'",
                          new_dataset, exc, current_dataset)
                with _lock:
                    _state["dataset"] = current_dataset
                    _state["switch_requested"] = False

        # Read current control state.
        with _lock:
            paused = _state["paused"]
            interval_ms = _state["interval_ms"]

        if paused:
            time.sleep(0.05)  # idle spin; react to resume quickly
            continue

        # Publish the current row.
        row = df.iloc[idx]
        try:
            msg = build_message(current_dataset, row, feature_cols, label_col)
            r.publish("transactions", msg)
            published += 1
        except redis.RedisError as exc:
            log.error("Publish failed (%s) — reconnecting to Redis", exc)
            r = connect_redis(REDIS_URL)
            continue  # retry same row
        except Exception as exc:  # noqa: BLE001
            log.warning("Skipping malformed row %d: %s", idx, exc)

        # Advance row index; wrap at end of file.
        idx = (idx + 1) % row_count

        # Update shared stats under the lock after every message.
        with _lock:
            _state["messages_sent"] = published

        # Log throughput and update rolling rate every 100 messages.
        if published % 100 == 0:
            elapsed = time.monotonic() - window_start
            rate = 100 / elapsed if elapsed > 0 else 0.0
            log.info("dataset=%s published=%d rate=%.1f msg/s interval_ms=%d",
                     current_dataset, published, rate, interval_ms)
            with _lock:
                _state["rate"] = rate
            window_start = time.monotonic()

        time.sleep(interval_ms / 1000.0)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    log.info(
        "Streamer starting — dataset=%s interval_ms=%d redis=%s data_dir=%s",
        START_DATASET, START_INTERVAL_MS, REDIS_URL, DATA_DIR,
    )

    # Validate the starting dataset exists before launching threads.
    try:
        load_dataset(START_DATASET)
    except (FileNotFoundError, ValueError) as exc:
        log.error("Cannot load starting dataset '%s': %s", START_DATASET, exc)
        raise SystemExit(1) from exc

    # Start control subscriber as a daemon thread.
    ctrl_thread = threading.Thread(
        target=control_subscriber,
        args=(REDIS_URL,),
        daemon=True,
        name="control-subscriber",
    )
    ctrl_thread.start()

    # Start heartbeat writer as a daemon thread.
    hb_thread = threading.Thread(
        target=heartbeat_writer,
        args=(REDIS_URL,),
        daemon=True,
        name="heartbeat-writer",
    )
    hb_thread.start()

    # Run the publish loop on the main thread.
    publish_loop()


if __name__ == "__main__":
    main()
