"""
T42 — Model catalog sync and DB query helpers.

sync_registry_to_db(): upserts every model from registry.json into the `models` table.
  - Called at startup (after init_db + model load) and at the end of model.reload().
  - Source defaults to 'seeded'. Preserves 'trained' if the row already has that value.
  - Fully idempotent (ON CONFLICT DO UPDATE).

Query helpers used by the catalog endpoints in main.py:
  - fetch_catalog(engine, dataset?)
  - fetch_model_detail(engine, dataset, slug)
  - fetch_model_runs(engine, dataset, slug)
  - fetch_model_last_run(engine, dataset, slug)

All SQL is parameterized — no string interpolation on user-supplied values.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import sqlalchemy as sa
from sqlalchemy import text

logger = logging.getLogger(__name__)

# Allowed dataset slugs — validated before any SQL execution
_ALLOWED_DATASETS = frozenset({"fraud", "iot", "intrusion"})


def _validate_dataset(dataset: str) -> str:
    """Raise ValueError if dataset is not a known slug."""
    if dataset not in _ALLOWED_DATASETS:
        raise ValueError(f"Unknown dataset '{dataset}'")
    return dataset


def _validate_slug(slug: str) -> str:
    """
    Reject slugs that could cause injection or path traversal.
    Must match the same pattern enforced by the export endpoint.
    """
    import re
    if not re.match(r"^[a-z0-9][a-z0-9\-]{1,63}$", slug):
        raise ValueError(f"Invalid model slug '{slug}'")
    return slug


# ── Registry → DB sync (T42) ────────────────────────────────────────────────────

def sync_registry_to_db(engine: sa.Engine, registry: Dict[str, Any]) -> int:
    """
    Upsert every model from registry into the `models` table.
    Preserves source='trained' if a row already carries it; otherwise writes 'seeded'.
    Returns the number of rows upserted.
    """
    now = datetime.now(timezone.utc)
    count = 0

    with engine.begin() as conn:
        for dataset_slug, dataset_info in registry.items():
            for model_meta in dataset_info.get("models", []):
                slug = model_meta.get("slug", "")
                metrics = model_meta.get("metrics", {})
                formats = model_meta.get("formats", {})
                features = model_meta.get("features", [])

                # ON CONFLICT: update all mutable fields except source.
                # If the existing row has source='trained' we keep it;
                # otherwise we set 'seeded'.  The EXCLUDED pseudo-table holds
                # the incoming values; we coalesce to keep 'trained'.
                import json as _json
                conn.execute(
                    text(
                        """
                        INSERT INTO models
                            (dataset, slug, name, algo,
                             accuracy, precision, recall, train_fraction,
                             trained_at, formats, features, source,
                             created_at, updated_at)
                        VALUES
                            (:dataset, :slug, :name, :algo,
                             :accuracy, :precision, :recall, :train_fraction,
                             :trained_at,
                             CAST(:formats AS jsonb),
                             CAST(:features AS jsonb),
                             'seeded',
                             :now, :now)
                        ON CONFLICT (dataset, slug) DO UPDATE SET
                            name            = EXCLUDED.name,
                            algo            = EXCLUDED.algo,
                            accuracy        = EXCLUDED.accuracy,
                            precision       = EXCLUDED.precision,
                            recall          = EXCLUDED.recall,
                            train_fraction  = COALESCE(models.train_fraction, EXCLUDED.train_fraction),
                            trained_at      = EXCLUDED.trained_at,
                            formats         = EXCLUDED.formats,
                            features        = EXCLUDED.features,
                            source          = CASE
                                                WHEN models.source = 'trained' THEN 'trained'
                                                ELSE 'seeded'
                                              END,
                            updated_at      = EXCLUDED.updated_at
                        """
                    ),
                    {
                        "dataset": dataset_slug,
                        "slug": slug,
                        "name": model_meta.get("name", slug),
                        "algo": model_meta.get("algo", "unknown"),
                        "accuracy": metrics.get("accuracy"),
                        "precision": metrics.get("precision"),
                        "recall": metrics.get("recall"),
                        "train_fraction": model_meta.get("train_fraction"),
                        "trained_at": model_meta.get("trained_at"),
                        "formats": _json.dumps(formats),
                        "features": _json.dumps(features),
                        "now": now,
                    },
                )
                count += 1
                logger.debug("Upserted model catalog row: (%s, %s)", dataset_slug, slug)

        # Prune orphans: the registry is the source of truth. Any catalog row whose
        # (dataset, slug) is no longer present in the registry (e.g. a throwaway model
        # whose files were deleted) must be removed so /models never lists phantoms.
        keys = [
            f"{d}|{m.get('slug', '')}"
            for d, info in registry.items()
            for m in info.get("models", [])
        ]
        if keys:
            conn.execute(
                text("DELETE FROM model_runs WHERE dataset || '|' || model_slug <> ALL(:keys)"),
                {"keys": keys},
            )
            pruned = conn.execute(
                text("DELETE FROM models WHERE dataset || '|' || slug <> ALL(:keys)"),
                {"keys": keys},
            )
            if pruned.rowcount:
                logger.info("sync_registry_to_db: pruned %d orphaned model rows", pruned.rowcount)

    logger.info("sync_registry_to_db: upserted %d model rows", count)
    return count


# ── Query helpers (T42) ─────────────────────────────────────────────────────────

def fetch_catalog(engine: sa.Engine, dataset: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Return all catalog rows with each model's last-run summary (LEFT JOIN on is_last).
    Optionally filter by dataset.
    All parameters are bound — no interpolation.
    """
    if dataset is not None:
        _validate_dataset(dataset)

    with engine.connect() as conn:
        if dataset is not None:
            rows = conn.execute(
                text(
                    """
                    SELECT
                        m.id, m.dataset, m.slug, m.name, m.algo,
                        m.accuracy, m.precision, m.recall, m.train_fraction,
                        m.trained_at, m.formats, m.features, m.source,
                        m.created_at, m.updated_at,
                        r.id          AS run_id,
                        r.started_at  AS run_started_at,
                        r.ended_at    AS run_ended_at,
                        r.total       AS run_total,
                        r.correct     AS run_correct,
                        r.accuracy    AS run_accuracy,
                        r.avg_latency_ms   AS run_avg_latency_ms,
                        r.p95_latency_ms   AS run_p95_latency_ms,
                        r.throughput_per_sec AS run_throughput_per_sec
                    FROM models m
                    LEFT JOIN model_runs r
                           ON r.dataset = m.dataset
                          AND r.model_slug = m.slug
                          AND r.is_last = true
                    WHERE m.dataset = :ds
                    ORDER BY m.dataset, m.slug
                    """
                ),
                {"ds": dataset},
            ).fetchall()
        else:
            rows = conn.execute(
                text(
                    """
                    SELECT
                        m.id, m.dataset, m.slug, m.name, m.algo,
                        m.accuracy, m.precision, m.recall, m.train_fraction,
                        m.trained_at, m.formats, m.features, m.source,
                        m.created_at, m.updated_at,
                        r.id          AS run_id,
                        r.started_at  AS run_started_at,
                        r.ended_at    AS run_ended_at,
                        r.total       AS run_total,
                        r.correct     AS run_correct,
                        r.accuracy    AS run_accuracy,
                        r.avg_latency_ms   AS run_avg_latency_ms,
                        r.p95_latency_ms   AS run_p95_latency_ms,
                        r.throughput_per_sec AS run_throughput_per_sec
                    FROM models m
                    LEFT JOIN model_runs r
                           ON r.dataset = m.dataset
                          AND r.model_slug = m.slug
                          AND r.is_last = true
                    ORDER BY m.dataset, m.slug
                    """
                ),
            ).fetchall()

    return [_catalog_row_to_dict(r) for r in rows]


def fetch_model_detail(engine: sa.Engine, dataset: str, slug: str) -> Optional[Dict[str, Any]]:
    """
    Return full detail for one model. Returns None if not found.
    """
    _validate_dataset(dataset)
    _validate_slug(slug)

    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT
                    id, dataset, slug, name, algo,
                    accuracy, precision, recall, train_fraction,
                    trained_at, formats, features, source,
                    created_at, updated_at
                FROM models
                WHERE dataset = :ds AND slug = :slug
                """
            ),
            {"ds": dataset, "slug": slug},
        ).fetchone()

    if row is None:
        return None
    return _detail_row_to_dict(row)


def fetch_model_runs(engine: sa.Engine, dataset: str, slug: str) -> List[Dict[str, Any]]:
    """
    Return all benchmark runs for a model, most recent first.
    """
    _validate_dataset(dataset)
    _validate_slug(slug)

    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT
                    id, dataset, model_slug, started_at, ended_at,
                    total, correct, accuracy, confusion,
                    avg_latency_ms, p95_latency_ms, throughput_per_sec, is_last
                FROM model_runs
                WHERE dataset = :ds AND model_slug = :slug
                ORDER BY started_at DESC
                """
            ),
            {"ds": dataset, "slug": slug},
        ).fetchall()

    return [_run_row_to_dict(r) for r in rows]


def fetch_model_last_run(engine: sa.Engine, dataset: str, slug: str) -> Optional[Dict[str, Any]]:
    """
    Return the is_last=true run for a model, or None.
    """
    _validate_dataset(dataset)
    _validate_slug(slug)

    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT
                    id, dataset, model_slug, started_at, ended_at,
                    total, correct, accuracy, confusion,
                    avg_latency_ms, p95_latency_ms, throughput_per_sec, is_last
                FROM model_runs
                WHERE dataset = :ds AND model_slug = :slug AND is_last = true
                LIMIT 1
                """
            ),
            {"ds": dataset, "slug": slug},
        ).fetchone()

    return _run_row_to_dict(row) if row else None


# ── Row serializers ─────────────────────────────────────────────────────────────

def _catalog_row_to_dict(r: Any) -> Dict[str, Any]:
    last_run = None
    if r.run_id is not None:
        last_run = {
            "id": int(r.run_id),
            "started_at": r.run_started_at.isoformat() if r.run_started_at else None,
            "ended_at": r.run_ended_at.isoformat() if r.run_ended_at else None,
            "total": int(r.run_total) if r.run_total is not None else 0,
            "correct": int(r.run_correct) if r.run_correct is not None else 0,
            "accuracy": round(float(r.run_accuracy), 6) if r.run_accuracy is not None else None,
            "avg_latency_ms": round(float(r.run_avg_latency_ms), 3) if r.run_avg_latency_ms is not None else None,
            "p95_latency_ms": round(float(r.run_p95_latency_ms), 3) if r.run_p95_latency_ms is not None else None,
            "throughput_per_sec": round(float(r.run_throughput_per_sec), 4) if r.run_throughput_per_sec is not None else None,
        }
    return {
        "id": int(r.id),
        "dataset": r.dataset,
        "slug": r.slug,
        "name": r.name,
        "algo": r.algo,
        "accuracy": float(r.accuracy) if r.accuracy is not None else None,
        "precision": float(r.precision) if r.precision is not None else None,
        "recall": float(r.recall) if r.recall is not None else None,
        "train_fraction": float(r.train_fraction) if r.train_fraction is not None else None,
        "trained_at": r.trained_at,
        "formats": r.formats,
        "features": r.features,
        "source": r.source,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        "last_run": last_run,
    }


def _detail_row_to_dict(r: Any) -> Dict[str, Any]:
    return {
        "id": int(r.id),
        "dataset": r.dataset,
        "slug": r.slug,
        "name": r.name,
        "algo": r.algo,
        "accuracy": float(r.accuracy) if r.accuracy is not None else None,
        "precision": float(r.precision) if r.precision is not None else None,
        "recall": float(r.recall) if r.recall is not None else None,
        "train_fraction": float(r.train_fraction) if r.train_fraction is not None else None,
        "trained_at": r.trained_at,
        "formats": r.formats,
        "features": r.features,
        "source": r.source,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


def _run_row_to_dict(r: Any) -> Dict[str, Any]:
    return {
        "id": int(r.id),
        "dataset": r.dataset,
        "model_slug": r.model_slug,
        "started_at": r.started_at.isoformat() if r.started_at else None,
        "ended_at": r.ended_at.isoformat() if r.ended_at else None,
        "total": int(r.total),
        "correct": int(r.correct),
        "accuracy": round(float(r.accuracy), 6),
        "confusion": r.confusion,
        "avg_latency_ms": round(float(r.avg_latency_ms), 3),
        "p95_latency_ms": round(float(r.p95_latency_ms), 3) if r.p95_latency_ms is not None else None,
        "throughput_per_sec": round(float(r.throughput_per_sec), 4),
        "is_last": bool(r.is_last),
    }
