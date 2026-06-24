"""
Database engine, session factory, and schema definition.
Uses SQLAlchemy Core (not ORM) with parameterized statements only.
Retries the connection with backoff because Postgres may still be starting.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

import sqlalchemy as sa
from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Double,
    Index,
    Integer,
    MetaData,
    SmallInteger,
    String,
    Table,
    Text,
    UniqueConstraint,
    create_engine,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.pool import QueuePool

logger = logging.getLogger(__name__)

# Populated by init_db()
_engine: sa.Engine | None = None
metadata = MetaData()

# ── Schema ─────────────────────────────────────────────────────────────────────
predictions = Table(
    "predictions",
    metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("dataset", Text, nullable=False),
    Column("model_name", Text, nullable=False),
    Column("received_at", DateTime(timezone=True), nullable=False),
    Column("processed_at", DateTime(timezone=True), nullable=False),
    Column("latency_ms", Double, nullable=False),
    Column("prediction", SmallInteger, nullable=False),
    Column("actual_label", SmallInteger, nullable=False),
    Column("is_correct", Boolean, nullable=False),
    Column("probability", Double, nullable=False),
    Column("payload", JSONB, nullable=True),
    # Indexes for time-series and accuracy rollup queries
    Index("ix_predictions_dataset_received_at", "dataset", "received_at"),
    Index("ix_predictions_dataset_is_correct", "dataset", "is_correct"),
)

# T41: model catalog — mirrors registry.json into Postgres; upserted at startup + reload
models_table = Table(
    "models",
    metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("dataset", Text, nullable=False),
    Column("slug", Text, nullable=False),
    Column("name", Text, nullable=False),
    Column("algo", Text, nullable=False),
    Column("accuracy", Double, nullable=True),
    Column("precision", Double, nullable=True),
    Column("recall", Double, nullable=True),
    # null for seeded models (pre-trained fraction unknown); set by trainer
    Column("train_fraction", Double, nullable=True),
    Column("trained_at", Text, nullable=True),
    Column("formats", JSONB, nullable=True),
    Column("features", JSONB, nullable=True),
    # 'seeded' = committed pre-trained; 'trained' = produced by trainer service
    Column("source", Text, nullable=False, server_default="seeded"),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
    UniqueConstraint("dataset", "slug", name="uq_models_dataset_slug"),
    Index("ix_models_dataset_slug", "dataset", "slug"),
)

# T41: per-model benchmark run — one row per active window; is_last=true is the most recent
model_runs = Table(
    "model_runs",
    metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("dataset", Text, nullable=False),
    Column("model_slug", Text, nullable=False),
    Column("started_at", DateTime(timezone=True), nullable=False),
    Column("ended_at", DateTime(timezone=True), nullable=True),
    Column("total", Integer, nullable=False),
    Column("correct", Integer, nullable=False),
    Column("accuracy", Double, nullable=False),
    # confusion matrix: tp/fp/tn/fn
    Column("confusion", JSONB, nullable=False),
    Column("avg_latency_ms", Double, nullable=False),
    Column("p95_latency_ms", Double, nullable=True),
    Column("throughput_per_sec", Double, nullable=False),
    # exactly one is_last=true per (dataset, model_slug) — the most recently finalized run
    Column("is_last", Boolean, nullable=False, server_default="false"),
    Index("ix_model_runs_dataset_slug_started", "dataset", "model_slug", "started_at"),
    Index("ix_model_runs_is_last", "dataset", "model_slug", "is_last"),
)


def init_db(database_url: str, max_retries: int = 10, backoff_s: float = 2.0) -> None:
    """
    Create the engine and ensure all tables exist.
    Retries up to max_retries times with exponential backoff.
    """
    global _engine
    for attempt in range(1, max_retries + 1):
        try:
            engine = create_engine(
                database_url,
                poolclass=QueuePool,
                pool_size=5,
                max_overflow=10,
                pool_pre_ping=True,  # detect stale connections
            )
            # Prove the connection is alive before accepting it
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            _engine = engine
            logger.info("Connected to Postgres on attempt %d", attempt)
            break
        except Exception as exc:
            wait = backoff_s * attempt
            if attempt == max_retries:
                logger.error("Could not connect to Postgres after %d attempts: %s", max_retries, exc)
                raise RuntimeError(f"Postgres unavailable after {max_retries} attempts") from exc
            logger.warning(
                "Postgres not ready (attempt %d/%d): %s — retrying in %.1fs",
                attempt,
                max_retries,
                exc,
                wait,
            )
            time.sleep(wait)

    # Idempotent: creates all tables + indexes only if they do not exist
    metadata.create_all(_engine, checkfirst=True)
    logger.info("All tables ready (predictions, models, model_runs)")


def get_engine() -> sa.Engine:
    if _engine is None:
        raise RuntimeError("Database not initialised — call init_db() first")
    return _engine
