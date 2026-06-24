"""
In-memory job store for training jobs.

Each job has:
  - status: "queued" | "running" | "done" | "error"
  - events: list of SSE payload dicts (progress + final)
  - error: optional error message
"""

from __future__ import annotations

import asyncio
import threading
import uuid
from dataclasses import dataclass, field
from typing import Any


@dataclass
class TrainingJob:
    job_id: str
    dataset: str
    algo: str
    name: str
    train_fraction: float = 0.7
    status: str = "queued"          # queued | running | done | error
    events: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None
    # asyncio event to signal new events are available (for SSE streaming)
    _event: asyncio.Event = field(default_factory=asyncio.Event)

    def add_event(self, payload: dict[str, Any]) -> None:
        """Append an event and notify any SSE consumer."""
        self.events.append(payload)
        # Signal all consumers; they re-arm themselves after each read.
        # We set from a thread, so use thread-safe call_soon_threadsafe.
        try:
            loop = asyncio.get_event_loop()
            loop.call_soon_threadsafe(self._event.set)
        except RuntimeError:
            pass  # No running loop — no SSE consumer yet, that's fine


# Global job store (keyed by job_id)
_jobs: dict[str, TrainingJob] = {}
_lock = threading.Lock()


def create_job(dataset: str, algo: str, name: str, train_fraction: float = 0.7) -> TrainingJob:
    job_id = str(uuid.uuid4())
    job = TrainingJob(job_id=job_id, dataset=dataset, algo=algo, name=name, train_fraction=train_fraction)
    with _lock:
        _jobs[job_id] = job
    return job


def list_jobs() -> list[TrainingJob]:
    with _lock:
        return list(_jobs.values())


def get_job(job_id: str) -> TrainingJob | None:
    with _lock:
        return _jobs.get(job_id)
