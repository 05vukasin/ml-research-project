"""
T43 — Per-model benchmark recorder.

Maintains an in-memory accumulator for the currently active (dataset, model_slug).
Updated on every prediction event via update().
Finalized (written to model_runs table) on model switch or idle timeout.

Thread-safe: all mutations hold _lock. DB writes are handed off to the caller's
thread pool so the event loop is never blocked.

Usage:
    from .benchmark import run_recorder
    run_recorder.update(dataset, slug, is_correct, label, actual, latency_ms)
    run_recorder.finalize(engine, prev_dataset, prev_slug, new_dataset, new_slug)
    run_recorder.current_snapshot(dataset, slug)  # for GET /current-run
"""

from __future__ import annotations

import json
import logging
import math
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

import sqlalchemy as sa
from sqlalchemy import text

logger = logging.getLogger(__name__)

# Maximum number of latency samples kept for p95 calculation (bounded memory)
_P95_SAMPLE_SIZE = 2000
# Idle timeout in seconds: finalize if no events received for this long
IDLE_TIMEOUT_S = 30.0


class _RunAccumulator:
    """Accumulates stats for one active (dataset, model_slug) window."""

    def __init__(self, dataset: str, slug: str) -> None:
        self.dataset = dataset
        self.slug = slug
        self.started_at: datetime = datetime.now(timezone.utc)
        self.last_event_mono: float = time.monotonic()
        self.total: int = 0
        self.correct: int = 0
        self.tp: int = 0
        self.fp: int = 0
        self.tn: int = 0
        self.fn: int = 0
        self.latency_sum: float = 0.0
        # Bounded circular buffer of latency samples for p95
        self._latency_samples: deque[float] = deque(maxlen=_P95_SAMPLE_SIZE)

    def record(self, is_correct: bool, label: int, actual: int, latency_ms: float) -> None:
        self.total += 1
        if is_correct:
            self.correct += 1
        if label == 1 and actual == 1:
            self.tp += 1
        elif label == 1 and actual == 0:
            self.fp += 1
        elif label == 0 and actual == 0:
            self.tn += 1
        else:
            self.fn += 1
        self.latency_sum += latency_ms
        self._latency_samples.append(latency_ms)
        self.last_event_mono = time.monotonic()

    def p95_latency(self) -> Optional[float]:
        samples = sorted(self._latency_samples)
        if not samples:
            return None
        idx = math.ceil(0.95 * len(samples)) - 1
        return samples[max(0, idx)]

    def avg_latency(self) -> float:
        return self.latency_sum / self.total if self.total > 0 else 0.0

    def accuracy(self) -> float:
        return self.correct / self.total if self.total > 0 else 0.0

    def elapsed_s(self) -> float:
        now = datetime.now(timezone.utc)
        return (now - self.started_at).total_seconds()

    def throughput(self) -> float:
        elapsed = self.elapsed_s()
        return self.total / elapsed if elapsed > 0 else 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "dataset": self.dataset,
            "model_slug": self.slug,
            "started_at": self.started_at.isoformat(),
            "total": self.total,
            "correct": self.correct,
            "accuracy": round(self.accuracy(), 6),
            "confusion": {
                "tp": self.tp,
                "fp": self.fp,
                "tn": self.tn,
                "fn": self.fn,
            },
            "avg_latency_ms": round(self.avg_latency(), 3),
            "p95_latency_ms": round(self.p95_latency(), 3) if self.p95_latency() is not None else None,
            "throughput_per_sec": round(self.throughput(), 4),
            "elapsed_s": round(self.elapsed_s(), 1),
        }


class BenchmarkRecorder:
    """
    Thread-safe recorder. One active accumulator at a time (per active model).
    Previous accumulators are finalized to DB on model switch.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        # Current active accumulator (keyed by dataset+slug, but only one at a time)
        self._current: Optional[_RunAccumulator] = None

    def update(
        self,
        dataset: str,
        slug: str,
        is_correct: bool,
        label: int,
        actual: int,
        latency_ms: float,
    ) -> None:
        """
        Record one prediction for (dataset, slug).
        If the accumulator key matches current, update it.
        If it doesn't match, the caller should finalize first via finalize().
        """
        with self._lock:
            if self._current is None or (
                self._current.dataset != dataset or self._current.slug != slug
            ):
                # Bootstrap accumulator for this key if not set yet
                self._current = _RunAccumulator(dataset, slug)
            self._current.record(is_correct, label, actual, latency_ms)

    def current_snapshot(self, dataset: str, slug: str) -> Optional[Dict[str, Any]]:
        """Return a snapshot of the live accumulator for (dataset, slug), or None."""
        with self._lock:
            if self._current and self._current.dataset == dataset and self._current.slug == slug:
                return self._current.to_dict()
        return None

    def get_active_key(self) -> Optional[Tuple[str, str]]:
        """Return (dataset, slug) of the current accumulator, or None."""
        with self._lock:
            if self._current:
                return (self._current.dataset, self._current.slug)
        return None

    def is_idle(self) -> bool:
        """True if the accumulator has had no events for IDLE_TIMEOUT_S seconds."""
        with self._lock:
            if self._current is None or self._current.total == 0:
                return False
            return (time.monotonic() - self._current.last_event_mono) >= IDLE_TIMEOUT_S

    def finalize_and_reset(
        self,
        engine: sa.Engine,
        new_dataset: str,
        new_slug: str,
    ) -> None:
        """
        Write the current accumulator to model_runs (if it has any data),
        then reset to a fresh accumulator for (new_dataset, new_slug).
        Safe to call even if current is None or has zero events.
        DB write is synchronous (call from thread pool).
        """
        with self._lock:
            acc = self._current
            # Reset immediately so the hot path can continue
            self._current = _RunAccumulator(new_dataset, new_slug)

        if acc is None or acc.total == 0:
            logger.debug("finalize_and_reset: nothing to finalize (no events)")
            return

        _write_run_to_db(engine, acc)

    def finalize_idle(self, engine: sa.Engine) -> None:
        """
        Called by the idle-check timer. Finalizes if stale; keeps the same key
        so the next event opens a fresh accumulator for the same model.
        """
        with self._lock:
            acc = self._current
            if acc is None or acc.total == 0:
                return
            if (time.monotonic() - acc.last_event_mono) < IDLE_TIMEOUT_S:
                return
            # Replace with a fresh accumulator for the same key
            self._current = _RunAccumulator(acc.dataset, acc.slug)

        _write_run_to_db(engine, acc)


def _write_run_to_db(engine: sa.Engine, acc: _RunAccumulator) -> None:
    """
    Upsert a model_runs row for the given accumulator.
    Sets is_last=true on this row and clears it on all prior rows for the same model.
    Uses parameterized SQL only.
    """
    ended_at = datetime.now(timezone.utc)
    elapsed = (ended_at - acc.started_at).total_seconds()
    throughput = acc.total / elapsed if elapsed > 0 else 0.0

    try:
        with engine.begin() as conn:
            # Clear is_last on all previous runs for this model
            conn.execute(
                text(
                    """
                    UPDATE model_runs
                       SET is_last = false
                     WHERE dataset = :ds AND model_slug = :slug AND is_last = true
                    """
                ),
                {"ds": acc.dataset, "slug": acc.slug},
            )
            # Insert the new finalized run with is_last=true
            conn.execute(
                text(
                    """
                    INSERT INTO model_runs
                        (dataset, model_slug, started_at, ended_at,
                         total, correct, accuracy,
                         confusion, avg_latency_ms, p95_latency_ms,
                         throughput_per_sec, is_last)
                    VALUES
                        (:ds, :slug, :started_at, :ended_at,
                         :total, :correct, :accuracy,
                         CAST(:confusion AS jsonb), :avg_latency_ms, :p95_latency_ms,
                         :throughput_per_sec, true)
                    """
                ),
                {
                    "ds": acc.dataset,
                    "slug": acc.slug,
                    "started_at": acc.started_at,
                    "ended_at": ended_at,
                    "total": acc.total,
                    "correct": acc.correct,
                    "accuracy": acc.accuracy(),
                    "confusion": json.dumps({
                        "tp": acc.tp,
                        "fp": acc.fp,
                        "tn": acc.tn,
                        "fn": acc.fn,
                    }),
                    "avg_latency_ms": acc.avg_latency(),
                    "p95_latency_ms": acc.p95_latency(),
                    "throughput_per_sec": throughput,
                },
            )
        logger.info(
            "Finalized model_run for (%s, %s): total=%d accuracy=%.4f",
            acc.dataset, acc.slug, acc.total, acc.accuracy(),
        )
    except Exception as exc:
        logger.error("Failed to write model_run for (%s, %s): %s", acc.dataset, acc.slug, exc)


# Module-level singleton
run_recorder = BenchmarkRecorder()
