"""
Incremental training logic for the trainer service.

Reuses the same preprocessing, export, and registry-upsert logic as training/train.py.
Does NOT call .fit() at serving time — this service is explicitly the training pipeline,
separate from the inference (serving) path.

Algorithms:
  - random_forest: RandomForestClassifier(warm_start=True), grow n_estimators in batches.
  - sgd: SGDClassifier(loss='log_loss'), partial_fit over mini-batches.

Progress callbacks emit {step, total, accuracy, status} after each batch.
On completion: export joblib/pickle/onnx/pmml, write metadata.json, upsert registry.json,
call POST inference:/reload.
"""

from __future__ import annotations

import json
import logging
import pickle
import re
import traceback
from datetime import date
from pathlib import Path
from typing import Any, Callable

import httpx
import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import SGDClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, precision_score, recall_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

from .config import DATABASE_URL, DATASET_CONFIG, DATA_DIR, INFERENCE_URL, MODELS_DIR

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Early patch for skl2onnx numpy.bool_ → protobuf int coercion
# (mirrors training/train.py patch — must run before any skl2onnx import)
# ---------------------------------------------------------------------------
try:
    import onnx.helper as _onnx_helper

    _orig_make_attribute = _onnx_helper.make_attribute

    def _patched_make_attribute(key: str, value: Any, doc_string=None, attr_type=None):  # type: ignore[no-untyped-def]
        if isinstance(value, bool):
            value = int(value)
        elif isinstance(value, (list, tuple)) and value:
            if isinstance(value[0], bool):
                value = [int(v) for v in value]
        return _orig_make_attribute(key, value, doc_string=doc_string, attr_type=attr_type)

    _onnx_helper.make_attribute = _patched_make_attribute  # type: ignore[assignment]
except ImportError:
    pass

# ---------------------------------------------------------------------------
# Slug helper
# ---------------------------------------------------------------------------

def slugify(name: str) -> str:
    """'Live Demo RF' -> 'live-demo-rf'."""
    name = name.lower()
    name = re.sub(r"[^a-z0-9]+", "-", name)
    return name.strip("-")


# ---------------------------------------------------------------------------
# Security: sanitize output path to prevent path traversal
# ---------------------------------------------------------------------------

def safe_output_dir(models_dir: Path, dataset: str, slug: str) -> Path:
    """Resolve output directory and assert it stays within models_dir."""
    out_dir = (models_dir / dataset).resolve()
    base = models_dir.resolve()
    if not str(out_dir).startswith(str(base)):
        raise ValueError(f"Path traversal detected: {out_dir}")
    # Also validate slug characters (already slugified, but belt-and-suspenders)
    if not re.fullmatch(r"[a-z0-9][a-z0-9\-]*", slug):
        raise ValueError(f"Invalid slug: {slug!r}")
    return out_dir


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_dataset(dataset: str, data_dir: Path) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """Load CSV, return (X_float32, y, feature_cols)."""
    csv_path = data_dir / dataset / "sample.csv"
    if not csv_path.exists():
        raise FileNotFoundError(f"Dataset CSV not found: {csv_path}")

    cfg = DATASET_CONFIG[dataset]
    label_col = cfg["label_col"]

    df = pd.read_csv(csv_path)

    if label_col not in df.columns:
        raise ValueError(f"Label column '{label_col}' not in {csv_path.name}")

    feature_cols = [c for c in df.columns if c != label_col]

    X = df[feature_cols].values.astype(np.float32)
    y = df[label_col].values

    logger.info("Loaded %s: shape=%s, positive=%.1f%%", dataset, df.shape, y.mean() * 100)
    return X, y, feature_cols


# ---------------------------------------------------------------------------
# Evaluation helper
# ---------------------------------------------------------------------------

def _evaluate(model: Any, X_test: np.ndarray, y_test: np.ndarray) -> dict[str, float]:
    y_pred = model.predict(X_test)
    return {
        "accuracy": round(float(accuracy_score(y_test, y_pred)), 4),
        "precision": round(float(precision_score(y_test, y_pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y_test, y_pred, zero_division=0)), 4),
    }


# ---------------------------------------------------------------------------
# Incremental training — random_forest
# ---------------------------------------------------------------------------

RF_STEPS = 16          # number of batches
RF_ESTIMATORS_FINAL = 120  # total trees at the end

def _train_random_forest(
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_test: np.ndarray,
    y_test: np.ndarray,
    emit: Callable[[dict[str, Any]], None],
) -> RandomForestClassifier:
    """Grow a RandomForest incrementally with warm_start, emitting progress per batch."""
    model = RandomForestClassifier(
        n_estimators=1,
        warm_start=True,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
    )

    # Distribute estimators across steps: roughly linear ramp from 1 to RF_ESTIMATORS_FINAL
    estimator_schedule = np.linspace(1, RF_ESTIMATORS_FINAL, RF_STEPS, dtype=int)
    # Ensure strict monotone increase (linspace guarantees this but pin it)
    estimator_schedule = np.maximum.accumulate(estimator_schedule)

    for step, n_est in enumerate(estimator_schedule, start=1):
        model.n_estimators = int(n_est)
        model.fit(X_train, y_train)
        metrics = _evaluate(model, X_test, y_test)
        emit({
            "step": step,
            "total": RF_STEPS,
            "accuracy": metrics["accuracy"],
            "status": "training",
        })
        logger.debug("RF step %d/%d  n_est=%d  acc=%.4f", step, RF_STEPS, n_est, metrics["accuracy"])

    return model


# ---------------------------------------------------------------------------
# Incremental training — sgd
# ---------------------------------------------------------------------------

SGD_EPOCHS = 16  # number of full passes over the training set

def _train_sgd(
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_test: np.ndarray,
    y_test: np.ndarray,
    emit: Callable[[dict[str, Any]], None],
) -> SGDClassifier:
    """Train SGDClassifier with partial_fit, one epoch per step, emitting progress per epoch.

    We do full passes (epochs) over the training data so each step sees all data
    and accuracy reliably improves over the course of training.
    partial_fit does not accept class_weight='balanced' directly; we compute
    sample weights per batch manually using sklearn's compute_class_weight.
    """
    from sklearn.utils.class_weight import compute_class_weight

    # Compute balanced class weights from the full training set
    classes = np.array([0, 1])
    cw = compute_class_weight("balanced", classes=classes, y=y_train)
    class_weight_dict = {0: cw[0], 1: cw[1]}
    sample_weight_full = np.array([class_weight_dict[int(yi)] for yi in y_train])

    model = SGDClassifier(
        loss="log_loss",
        random_state=42,
        max_iter=1,
        tol=None,
    )

    rng = np.random.default_rng(42)

    for step in range(1, SGD_EPOCHS + 1):
        # Shuffle each epoch independently for proper SGD behaviour
        perm = rng.permutation(len(X_train))
        model.partial_fit(
            X_train[perm], y_train[perm],
            classes=classes,
            sample_weight=sample_weight_full[perm],
        )
        metrics = _evaluate(model, X_test, y_test)
        emit({
            "step": step,
            "total": SGD_EPOCHS,
            "accuracy": metrics["accuracy"],
            "status": "training",
        })
        logger.debug("SGD epoch %d/%d  acc=%.4f", step, SGD_EPOCHS, metrics["accuracy"])

    return model


# ---------------------------------------------------------------------------
# Export functions (mirrors training/train.py exactly)
# ---------------------------------------------------------------------------

def export_joblib(model: Any, scaler: StandardScaler, out_dir: Path, slug: str) -> str:
    model_path = out_dir / f"{slug}.joblib"
    joblib.dump(model, model_path)
    scaler_path = out_dir / "scaler.joblib"
    joblib.dump(scaler, scaler_path)
    logger.info("joblib -> %s", model_path.name)
    return f"{slug}.joblib"


def export_pickle(model: Any, out_dir: Path, slug: str) -> str:
    pkl_path = out_dir / f"{slug}.pkl"
    with open(pkl_path, "wb") as f:
        pickle.dump(model, f, protocol=pickle.HIGHEST_PROTOCOL)
    logger.info("pickle -> %s", pkl_path.name)
    return f"{slug}.pkl"


def export_onnx(model: Any, feature_names: list[str], out_dir: Path, slug: str) -> str | None:
    try:
        from skl2onnx import convert_sklearn
        from skl2onnx.common.data_types import FloatTensorType

        n_features = len(feature_names)
        initial_type = [("float_input", FloatTensorType([None, n_features]))]
        onnx_model = convert_sklearn(model, initial_types=initial_type)
        onnx_path = out_dir / f"{slug}.onnx"
        with open(onnx_path, "wb") as f:
            f.write(onnx_model.SerializeToString())
        logger.info("onnx -> %s", onnx_path.name)
        return f"{slug}.onnx"
    except Exception as exc:
        logger.warning("ONNX export failed: %s", exc)
        traceback.print_exc()
        return None


def export_pmml(
    model: Any,
    scaler: StandardScaler,
    feature_names: list[str],
    out_dir: Path,
    slug: str,
) -> str | None:
    try:
        from sklearn.pipeline import Pipeline
        from sklearn2pmml import PMMLPipeline, sklearn2pmml

        pipeline = PMMLPipeline([
            ("scaler", scaler),
            ("classifier", model),
        ])
        pmml_path = out_dir / f"{slug}.pmml"
        sklearn2pmml(pipeline, str(pmml_path), with_repr=False)
        logger.info("pmml -> %s", pmml_path.name)
        return f"{slug}.pmml"
    except Exception as exc:
        logger.warning("PMML export skipped (Java/sklearn2pmml unavailable): %s", exc)
        return None


# ---------------------------------------------------------------------------
# Registry upsert (mirrors training/train.py upsert_registry)
# ---------------------------------------------------------------------------

def upsert_registry(
    registry_path: Path,
    dataset: str,
    model_entry: dict[str, Any],
) -> None:
    cfg = DATASET_CONFIG[dataset]

    if registry_path.exists() and registry_path.stat().st_size > 2:
        with open(registry_path) as f:
            registry: dict = json.load(f)
    else:
        registry = {}

    if dataset not in registry:
        registry[dataset] = {
            "label": cfg["label"],
            "positive_label": cfg["positive_label"],
            "theme": {"accent": cfg["accent"]},
            "models": [],
        }

    slug = model_entry["slug"]
    existing: list = registry[dataset]["models"]
    idx = next((i for i, m in enumerate(existing) if m["slug"] == slug), None)
    if idx is not None:
        existing[idx] = model_entry
    else:
        existing.append(model_entry)

    with open(registry_path, "w") as f:
        json.dump(registry, f, indent=2)
    logger.info("registry upserted: %s", registry_path)


# ---------------------------------------------------------------------------
# DB write — upsert into `models` table (T44)
# ---------------------------------------------------------------------------

def upsert_model_to_db(
    dataset: str,
    slug: str,
    name: str,
    algo: str,
    metrics: dict[str, float],
    train_fraction: float,
    trained_at: str,
    formats: dict[str, str | None],
    features: list[str],
    database_url: str = DATABASE_URL,
) -> None:
    """
    Upsert a row into the `models` table with source='trained'.
    Tolerates DB being unreachable — logs a warning and returns without raising.
    Uses a short-lived engine/connection (no long-lived pool).
    """
    import json as _json
    from datetime import datetime, timezone

    from sqlalchemy import create_engine, text

    now = datetime.now(timezone.utc)

    sql = text(
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
             'trained',
             :now, :now)
        ON CONFLICT (dataset, slug) DO UPDATE SET
            name           = EXCLUDED.name,
            algo           = EXCLUDED.algo,
            accuracy       = EXCLUDED.accuracy,
            precision      = EXCLUDED.precision,
            recall         = EXCLUDED.recall,
            train_fraction = EXCLUDED.train_fraction,
            trained_at     = EXCLUDED.trained_at,
            formats        = EXCLUDED.formats,
            features       = EXCLUDED.features,
            source         = 'trained',
            updated_at     = EXCLUDED.updated_at
        """
    )
    params = {
        "dataset": dataset,
        "slug": slug,
        "name": name,
        "algo": algo,
        "accuracy": metrics.get("accuracy"),
        "precision": metrics.get("precision"),
        "recall": metrics.get("recall"),
        "train_fraction": train_fraction,
        "trained_at": trained_at,
        "formats": _json.dumps(formats),
        "features": _json.dumps(features),
        "now": now,
    }

    try:
        engine = create_engine(database_url, pool_pre_ping=True)
        with engine.begin() as conn:
            conn.execute(sql, params)
        engine.dispose()
        logger.info("DB upsert OK: models (%s, %s) source='trained'", dataset, slug)
    except Exception as exc:
        logger.warning("DB upsert skipped (DB unreachable or unavailable): %s", exc)


# ---------------------------------------------------------------------------
# Notify inference to hot-reload
# ---------------------------------------------------------------------------

def notify_reload(inference_url: str = INFERENCE_URL) -> bool:
    """POST /reload to inference. Returns True on success. Tolerates unreachable."""
    try:
        resp = httpx.post(f"{inference_url}/reload", timeout=10.0)
        resp.raise_for_status()
        logger.info("inference /reload -> %s", resp.status_code)
        return True
    except Exception as exc:
        logger.warning("Could not reach inference for /reload: %s", exc)
        return False


# ---------------------------------------------------------------------------
# Full training pipeline (called from background job)
# ---------------------------------------------------------------------------

def run_training_job(
    dataset: str,
    algo: str,
    name: str,
    emit: Callable[[dict[str, Any]], None],
    models_dir: Path = MODELS_DIR,
    data_dir: Path = DATA_DIR,
    inference_url: str = INFERENCE_URL,
    train_fraction: float = 0.7,
) -> dict[str, Any]:
    """
    Run the full training pipeline for one job.

    Calls emit() after each incremental step with {step, total, accuracy, status}.
    Returns final result dict (also emitted as the terminal event).

    train_fraction controls what fraction of data is used for training (0.05–1.0).
    """
    slug = slugify(name)
    out_dir = safe_output_dir(models_dir, dataset, slug)
    out_dir.mkdir(parents=True, exist_ok=True)

    logger.info(
        "Training job: dataset=%s algo=%s name=%s slug=%s train_fraction=%.2f",
        dataset, algo, name, slug, train_fraction,
    )

    # 1. Load data
    X, y, feature_cols = load_dataset(dataset, data_dir)

    # 2. Scale
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # 3. Stratified split — fraction determined by train_fraction
    test_size = round(1.0 - train_fraction, 10)
    # Clamp test_size so train_test_split never gets 0 or 1
    test_size = max(0.01, min(0.95, test_size))
    X_train, X_test, y_train, y_test = train_test_split(
        X_scaled, y, test_size=test_size, random_state=42, stratify=y
    )
    logger.info(
        "Split (train_fraction=%.2f): train=%d, test=%d",
        train_fraction, len(X_train), len(X_test),
    )

    # 4. Incremental fit
    if algo == "random_forest":
        model = _train_random_forest(X_train, y_train, X_test, y_test, emit)
    elif algo == "sgd":
        model = _train_sgd(X_train, y_train, X_test, y_test, emit)
    else:
        raise ValueError(f"Unknown algo: {algo!r}")

    # 5. Final evaluation
    metrics = _evaluate(model, X_test, y_test)
    logger.info("Final metrics: %s", metrics)

    # 6. Export all formats
    cfg = DATASET_CONFIG[dataset]
    algo_label = model.__class__.__name__

    joblib_file = export_joblib(model, scaler, out_dir, slug)
    pickle_file = export_pickle(model, out_dir, slug)
    onnx_file = export_onnx(model, feature_cols, out_dir, slug)
    pmml_file = export_pmml(model, scaler, feature_cols, out_dir, slug)

    formats = {
        "joblib": joblib_file,
        "pickle": pickle_file,
        "onnx": onnx_file,
        "pmml": pmml_file,
    }

    # 7. Write per-model metadata file (<slug>.metadata.json).
    #    IMPORTANT: do NOT touch the shared metadata.json — that belongs to the seeded model.
    trained_at = date.today().isoformat()
    per_model_metadata: dict[str, Any] = {
        "name": name,
        "slug": slug,
        "dataset": dataset,
        "algo": algo_label,
        "features": feature_cols,
        "classes": cfg["classes"],
        "metrics": metrics,
        "trained_at": trained_at,
        "train_fraction": train_fraction,
        "formats": formats,
        "scaler": "scaler.joblib",
    }
    per_meta_path = out_dir / f"{slug}.metadata.json"
    with open(per_meta_path, "w") as f:
        json.dump(per_model_metadata, f, indent=2)
    logger.info("per-model metadata written: %s", per_meta_path)

    # 8. Upsert registry.json (includes train_fraction)
    registry_entry: dict[str, Any] = {
        "name": name,
        "slug": slug,
        "algo": algo_label,
        "features": feature_cols,
        "classes": cfg["classes"],
        "metrics": metrics,
        "trained_at": trained_at,
        "train_fraction": train_fraction,
        "formats": formats,
        "scaler": "scaler.joblib",
    }
    upsert_registry(models_dir / "registry.json", dataset, registry_entry)

    # 9. Upsert models table in Postgres (source='trained')
    upsert_model_to_db(
        dataset=dataset,
        slug=slug,
        name=name,
        algo=algo_label,
        metrics=metrics,
        train_fraction=train_fraction,
        trained_at=trained_at,
        formats=formats,
        features=feature_cols,
    )

    # 10. Notify inference
    reload_ok = notify_reload(inference_url)

    result: dict[str, Any] = {
        "status": "done",
        "dataset": dataset,
        "name": name,
        "slug": slug,
        "algo": algo_label,
        "accuracy": metrics["accuracy"],
        "precision": metrics["precision"],
        "recall": metrics["recall"],
        "train_fraction": train_fraction,
        "formats": formats,
        "reload_ok": reload_ok,
    }
    return result
