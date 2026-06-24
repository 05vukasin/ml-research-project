"""
In-memory running aggregates + SQL helpers for DB-backed /metrics endpoint.

In-memory: updated on every prediction event (fast, no DB round-trip).
SQL helpers: called by the /metrics endpoint for accurate DB-backed numbers.
"""

from __future__ import annotations

import time
import threading
from collections import deque
from datetime import datetime, timezone
from typing import Any, Dict, List

import sqlalchemy as sa
from sqlalchemy import text


# ── In-memory per-dataset aggregates ──────────────────────────────────────────

class DatasetAggregates:
    """Running aggregates for a single dataset. Thread-safe."""

    # Sliding window size for throughput calculation (seconds)
    WINDOW_S = 30

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.total: int = 0
        self.correct: int = 0
        self.positive_count: int = 0
        self.latency_sum: float = 0.0
        # Timestamps of recent events for throughput
        self._timestamps: deque[float] = deque()

    def record(self, is_correct: bool, is_positive: bool, latency_ms: float) -> None:
        now = time.monotonic()
        with self._lock:
            self.total += 1
            if is_correct:
                self.correct += 1
            if is_positive:
                self.positive_count += 1
            self.latency_sum += latency_ms
            self._timestamps.append(now)
            # Prune old entries outside the window
            cutoff = now - self.WINDOW_S
            while self._timestamps and self._timestamps[0] < cutoff:
                self._timestamps.popleft()

    def snapshot(self) -> Dict[str, float]:
        now = time.monotonic()
        with self._lock:
            total = self.total
            correct = self.correct
            positive_count = self.positive_count
            latency_sum = self.latency_sum
            # Count events in the last WINDOW_S seconds
            cutoff = now - self.WINDOW_S
            recent = sum(1 for t in self._timestamps if t >= cutoff)
            throughput = recent / self.WINDOW_S if total > 0 else 0.0

        accuracy = correct / total if total > 0 else 0.0
        avg_latency = latency_sum / total if total > 0 else 0.0

        return {
            "total": total,
            "correct": correct,
            "positive_count": positive_count,
            "running_accuracy": round(accuracy, 6),
            "throughput": round(throughput, 4),
            "avg_latency": round(avg_latency, 3),
        }


class AggregateStore:
    """Holds a DatasetAggregates per dataset slug."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._data: Dict[str, DatasetAggregates] = {}

    def _get_or_create(self, dataset: str) -> DatasetAggregates:
        with self._lock:
            if dataset not in self._data:
                self._data[dataset] = DatasetAggregates()
            return self._data[dataset]

    def record(self, dataset: str, is_correct: bool, is_positive: bool, latency_ms: float) -> None:
        self._get_or_create(dataset).record(is_correct, is_positive, latency_ms)

    def snapshot(self, dataset: str) -> Dict[str, Any]:
        return self._get_or_create(dataset).snapshot()


# Module-level singleton
agg_store = AggregateStore()


# ── SQL helpers for /metrics ───────────────────────────────────────────────────

def fetch_metrics(engine: sa.Engine, dataset: str) -> Dict[str, Any]:
    """
    Return DB-backed metrics for /metrics?dataset=.
    All queries use parameterized binds — no string interpolation.
    """
    with engine.connect() as conn:
        # Total + accuracy
        row = conn.execute(
            text(
                """
                SELECT
                    COUNT(*)                          AS total,
                    COALESCE(AVG(is_correct::int), 0) AS accuracy
                FROM predictions
                WHERE dataset = :ds
                """
            ),
            {"ds": dataset},
        ).fetchone()
        total = int(row.total) if row else 0
        accuracy = float(row.accuracy) if row else 0.0

        # Confusion matrix
        cm = conn.execute(
            text(
                """
                SELECT
                    SUM(CASE WHEN prediction = 1 AND actual_label = 1 THEN 1 ELSE 0 END) AS tp,
                    SUM(CASE WHEN prediction = 1 AND actual_label = 0 THEN 1 ELSE 0 END) AS fp,
                    SUM(CASE WHEN prediction = 0 AND actual_label = 0 THEN 1 ELSE 0 END) AS tn,
                    SUM(CASE WHEN prediction = 0 AND actual_label = 1 THEN 1 ELSE 0 END) AS fn
                FROM predictions
                WHERE dataset = :ds
                """
            ),
            {"ds": dataset},
        ).fetchone()
        confusion = {
            "tp": int(cm.tp or 0),
            "fp": int(cm.fp or 0),
            "tn": int(cm.tn or 0),
            "fn": int(cm.fn or 0),
        }

        # Latency avg / p95
        lat = conn.execute(
            text(
                """
                SELECT
                    COALESCE(AVG(latency_ms), 0)                              AS avg_lat,
                    COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP
                             (ORDER BY latency_ms), 0)                        AS p95_lat
                FROM predictions
                WHERE dataset = :ds
                """
            ),
            {"ds": dataset},
        ).fetchone()
        avg_latency = float(lat.avg_lat) if lat else 0.0
        p95_latency = float(lat.p95_lat) if lat else 0.0

        # Throughput: events per second over last 60 s
        tput = conn.execute(
            text(
                """
                SELECT COUNT(*) AS cnt
                FROM predictions
                WHERE dataset = :ds
                  AND received_at >= NOW() - INTERVAL '60 seconds'
                """
            ),
            {"ds": dataset},
        ).fetchone()
        throughput_per_sec = (int(tput.cnt) / 60.0) if tput else 0.0

        # Accuracy over time (1-minute buckets, last 30 buckets)
        aot_rows = conn.execute(
            text(
                """
                SELECT
                    DATE_TRUNC('minute', received_at) AS bucket,
                    AVG(is_correct::int)              AS accuracy,
                    COUNT(*)                          AS count
                FROM predictions
                WHERE dataset = :ds
                  AND received_at >= NOW() - INTERVAL '30 minutes'
                GROUP BY bucket
                ORDER BY bucket
                """
            ),
            {"ds": dataset},
        ).fetchall()
        accuracy_over_time: List[Dict[str, Any]] = [
            {
                "ts": row.bucket.isoformat(),
                "accuracy": round(float(row.accuracy), 4),
                "count": int(row.count),
            }
            for row in aot_rows
        ]

    return {
        "dataset": dataset,
        "total": total,
        "accuracy": round(accuracy, 6),
        "confusion": confusion,
        "avg_latency_ms": round(avg_latency, 3),
        "p95_latency_ms": round(p95_latency, 3),
        "throughput_per_sec": round(throughput_per_sec, 4),
        "accuracy_over_time": accuracy_over_time,
    }


def fetch_history(engine: sa.Engine, dataset: str, limit: int) -> List[Dict[str, Any]]:
    """Recent prediction rows for /history. Parameterized query only."""
    # Clamp limit to a sane maximum to prevent oversized responses
    limit = min(max(1, limit), 1000)
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT id, dataset, model_name, received_at, processed_at,
                       latency_ms, prediction, actual_label, is_correct, probability, payload
                FROM predictions
                WHERE dataset = :ds
                ORDER BY received_at DESC
                LIMIT :lim
                """
            ),
            {"ds": dataset, "lim": limit},
        ).fetchall()

    return [
        {
            "id": int(r.id),
            "dataset": r.dataset,
            "model_name": r.model_name,
            "received_at": r.received_at.isoformat(),
            "processed_at": r.processed_at.isoformat(),
            "latency_ms": float(r.latency_ms),
            "prediction": int(r.prediction),
            "actual_label": int(r.actual_label),
            "is_correct": bool(r.is_correct),
            "probability": float(r.probability),
            "payload": r.payload,
        }
        for r in rows
    ]


def fetch_progress(engine: sa.Engine, dataset: str, total_rows: int) -> Dict[str, Any]:
    """Rows processed vs total for /progress."""
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT COUNT(*) AS cnt FROM predictions WHERE dataset = :ds"),
            {"ds": dataset},
        ).fetchone()
    rows_processed = int(row.cnt) if row else 0
    percent = round(rows_processed / total_rows * 100, 2) if total_rows > 0 else 0.0
    return {
        "dataset": dataset,
        "rows_processed": rows_processed,
        "total_rows": total_rows,
        "percent": percent,
    }
