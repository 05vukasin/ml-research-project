"""
Pydantic models for request/response validation.
All external inputs are validated here before touching business logic.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator


# ── Control ────────────────────────────────────────────────────────────────────

class ControlPayload(BaseModel):
    interval_ms: Optional[int] = Field(None, ge=50, le=60_000, description="Streaming interval in ms")
    paused: Optional[bool] = None
    dataset: Optional[str] = None
    model: Optional[str] = None

    @field_validator("dataset", mode="before")
    @classmethod
    def validate_dataset(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        allowed = {"fraud", "iot", "intrusion"}
        if v not in allowed:
            raise ValueError(f"Unknown dataset '{v}'. Allowed: {allowed}")
        return v


# ── SSE event shape ────────────────────────────────────────────────────────────

class SSEEvent(BaseModel):
    id: int
    dataset: str
    prediction: int
    actual: int
    is_correct: bool
    probability: float
    latency_ms: float
    ts: str
    running_accuracy: float
    total_processed: int
    positive_count: int
    throughput: float
    avg_latency: float


# ── Metrics response ───────────────────────────────────────────────────────────

class ConfusionCounts(BaseModel):
    tp: int
    fp: int
    tn: int
    fn: int


class MetricsResponse(BaseModel):
    dataset: str
    total: int
    accuracy: float
    confusion: ConfusionCounts
    avg_latency_ms: float
    p95_latency_ms: float
    throughput_per_sec: float
    accuracy_over_time: List[Dict[str, Any]]


# ── History row ────────────────────────────────────────────────────────────────

class HistoryRow(BaseModel):
    id: int
    dataset: str
    model_name: str
    received_at: str
    processed_at: str
    latency_ms: float
    prediction: int
    actual_label: int
    is_correct: bool
    probability: float
    payload: Optional[Dict[str, Any]] = None


# ── Progress ───────────────────────────────────────────────────────────────────

class ProgressResponse(BaseModel):
    dataset: str
    rows_processed: int
    total_rows: int
    percent: float


# ── Health ─────────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str
    db: str
    redis: str
    models_loaded: int
    active_dataset: str
    active_model: str


# ── Reload ─────────────────────────────────────────────────────────────────────

class ReloadResponse(BaseModel):
    status: str
    models_loaded: int
    registry_summary: Dict[str, Any]
