"""
Model training pipeline for the MLOps project.

Usage:
    python train.py --dataset fraud --algo random_forest --name "FraudGuard v1" --date 2026-06-23
    python train.py --dataset iot   --algo random_forest --name "RotorMind v1"  --date 2026-06-23
    python train.py --dataset intrusion --algo random_forest --name "NetGuard v1" --date 2026-06-23

The model is NEVER trained at runtime. This script is the only place .fit() is called.
Artifacts written to models/<dataset>/:
  <slug>.joblib   — primary (what inference loads)
  <slug>.pkl      — pickle serialization
  <slug>.onnx     — ONNX portable format
  <slug>.pmml     — PMML XML (requires Java; set to null if unavailable)
  scaler.joblib   — StandardScaler fitted on training features
  metadata.json   — full metadata consumed by inference and dashboard
registry updated: models/registry.json
"""

import argparse
import json
import os
import pickle
import re
import sys
import traceback
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Early patch: skl2onnx 1.17.0 passes numpy.bool_ into onnx's make_attribute.
# Protobuf's C-extension rejects numpy.bool_ for the `ints` field. We wrap
# make_attribute to coerce any numpy bool values to plain Python int before
# the protobuf C-layer sees them. Must be applied before any skl2onnx import.
# ---------------------------------------------------------------------------
try:
    import onnx.helper as _onnx_helper  # noqa: E402

    _orig_make_attribute = _onnx_helper.make_attribute

    def _patched_make_attribute(key: str, value: Any, doc_string=None, attr_type=None):  # type: ignore[no-untyped-def]
        """Coerce bool/numpy.bool_ in lists to int before protobuf sees them.

        Protobuf's C-extension rejects bool values for `ints` fields. In numpy 2.x
        numpy.bool_ is bool, which is not numbers.Integral in onnx's type table.
        skl2onnx passes class_ids as a list of booleans with attr_type=INTS, which
        skips onnx's type inference and goes straight to attr.ints.extend(value) — fail.
        We coerce here before the extend.
        """
        if isinstance(value, bool):
            value = int(value)
        elif isinstance(value, (list, tuple)) and value:
            first = value[0]
            if isinstance(first, bool):
                value = [int(v) for v in value]
        return _orig_make_attribute(key, value, doc_string=doc_string, attr_type=attr_type)

    _onnx_helper.make_attribute = _patched_make_attribute  # type: ignore[assignment]
except ImportError:
    pass  # onnx not installed; export_onnx will handle gracefully
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, precision_score, recall_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier

# ---------------------------------------------------------------------------
# Dataset configuration
# ---------------------------------------------------------------------------

DATASET_CONFIG: dict[str, dict[str, Any]] = {
    "fraud": {
        "label_col": "is_fraud",
        "label": "Credit Card Fraud",
        "positive_label": "Fraud",
        "classes": {"0": "Legit", "1": "Fraud"},
        "accent": "#ef4444",
    },
    "iot": {
        "label_col": "failure",
        "label": "Predictive Maintenance",
        "positive_label": "Failure",
        "classes": {"0": "OK", "1": "Failure"},
        "accent": "#f59e0b",
    },
    "intrusion": {
        "label_col": "attack",
        "label": "Network Intrusion Detection",
        "positive_label": "Attack",
        "classes": {"0": "Normal", "1": "Attack"},
        "accent": "#8b5cf6",
    },
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def slugify(name: str) -> str:
    """Convert display name to kebab-case slug. 'FraudGuard v1' -> 'fraudguard-v1'."""
    name = name.lower()
    name = re.sub(r"[^a-z0-9]+", "-", name)
    return name.strip("-")


def load_dataset(dataset: str, data_dir: Path) -> tuple[pd.DataFrame, list[str], str]:
    """Load CSV, return (df, feature_columns, label_column)."""
    csv_path = data_dir / dataset / "sample.csv"
    if not csv_path.exists():
        raise FileNotFoundError(f"Dataset not found: {csv_path}")

    df = pd.read_csv(csv_path)
    label_col = DATASET_CONFIG[dataset]["label_col"]

    if label_col not in df.columns:
        raise ValueError(f"Label column '{label_col}' not found in {csv_path.name}")

    feature_cols = [c for c in df.columns if c != label_col]
    print(f"\n=== EDA: {dataset} ===")
    print(f"  Shape     : {df.shape}")
    print(f"  Features  : {feature_cols}")
    label_counts = df[label_col].value_counts()
    print(f"  Label dist: {label_counts.to_dict()}")
    print(f"  Positive % : {df[label_col].mean() * 100:.1f}%")
    print(f"  Nulls      : {df.isnull().sum().sum()}")

    return df, feature_cols, label_col


def build_model(algo: str) -> RandomForestClassifier | DecisionTreeClassifier:
    """Instantiate the chosen classifier with class_weight='balanced'."""
    if algo == "random_forest":
        return RandomForestClassifier(
            n_estimators=100,
            max_depth=None,
            class_weight="balanced",
            random_state=42,
            n_jobs=-1,
        )
    if algo == "decision_tree":
        return DecisionTreeClassifier(
            max_depth=10,
            class_weight="balanced",
            random_state=42,
        )
    raise ValueError(f"Unknown algo: {algo!r}. Choose 'random_forest' or 'decision_tree'.")


def evaluate(model: Any, X_test: np.ndarray, y_test: np.ndarray) -> dict[str, float]:
    """Return accuracy, precision, recall on test split."""
    y_pred = model.predict(X_test)
    metrics = {
        "accuracy": round(float(accuracy_score(y_test, y_pred)), 4),
        "precision": round(float(precision_score(y_test, y_pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y_test, y_pred, zero_division=0)), 4),
    }
    print(f"  Accuracy : {metrics['accuracy']:.4f}")
    print(f"  Precision: {metrics['precision']:.4f}")
    print(f"  Recall   : {metrics['recall']:.4f}")
    return metrics


# ---------------------------------------------------------------------------
# Export functions
# ---------------------------------------------------------------------------

def export_joblib(model: Any, scaler: StandardScaler, out_dir: Path, slug: str) -> str:
    """Export model and scaler as joblib. Returns filename."""
    model_path = out_dir / f"{slug}.joblib"
    joblib.dump(model, model_path)
    scaler_path = out_dir / "scaler.joblib"
    joblib.dump(scaler, scaler_path)
    print(f"  joblib  -> {model_path.name}")
    return f"{slug}.joblib"


def export_pickle(model: Any, out_dir: Path, slug: str) -> str:
    """Export model as pickle. Returns filename."""
    pkl_path = out_dir / f"{slug}.pkl"
    with open(pkl_path, "wb") as f:
        pickle.dump(model, f, protocol=pickle.HIGHEST_PROTOCOL)
    print(f"  pickle  -> {pkl_path.name}")
    return f"{slug}.pkl"


def export_onnx(
    model: Any,
    feature_names: list[str],
    out_dir: Path,
    slug: str,
) -> str | None:
    """Export model to ONNX via skl2onnx. Returns filename or None on failure.

    Note: The numpy.bool_ → protobuf int coercion patch is applied at module-load
    time (see top of file) before any skl2onnx import.
    """
    try:
        from skl2onnx import convert_sklearn
        from skl2onnx.common.data_types import FloatTensorType

        n_features = len(feature_names)
        initial_type = [("float_input", FloatTensorType([None, n_features]))]
        onnx_model = convert_sklearn(model, initial_types=initial_type)

        onnx_path = out_dir / f"{slug}.onnx"
        with open(onnx_path, "wb") as f:
            f.write(onnx_model.SerializeToString())
        print(f"  onnx    -> {onnx_path.name}")
        return f"{slug}.onnx"
    except Exception as exc:
        print(f"  onnx    -> FAILED: {exc}")
        traceback.print_exc()
        return None


def export_pmml(model: Any, scaler: StandardScaler, feature_names: list[str], out_dir: Path, slug: str) -> str | None:
    """
    Export model + scaler pipeline to PMML via sklearn2pmml.
    Requires Java (default-jre-headless). Returns filename or None if Java unavailable.
    """
    try:
        from sklearn.pipeline import Pipeline
        from sklearn2pmml import PMMLPipeline, sklearn2pmml

        pipeline = PMMLPipeline([
            ("scaler", scaler),
            ("classifier", model),
        ])
        # sklearn2pmml needs to re-fit to attach metadata; we use a dummy 1-row call
        # to keep it happy — the pipeline parameters are already fit.
        # Actually sklearn2pmml serializes the already-fitted pipeline; no refit needed.
        pmml_path = out_dir / f"{slug}.pmml"
        sklearn2pmml(pipeline, str(pmml_path), with_repr=False)
        print(f"  pmml    -> {pmml_path.name}")
        return f"{slug}.pmml"
    except Exception as exc:
        print(f"  pmml    -> SKIPPED (Java/sklearn2pmml unavailable): {exc}")
        return None


# ---------------------------------------------------------------------------
# Registry upsert
# ---------------------------------------------------------------------------

def upsert_registry(
    registry_path: Path,
    dataset: str,
    model_entry: dict[str, Any],
) -> None:
    """Upsert model entry into models/registry.json, preserving other datasets."""
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

    # Upsert by slug (replace if exists, append if new)
    slug = model_entry["slug"]
    existing_models: list = registry[dataset]["models"]
    idx = next((i for i, m in enumerate(existing_models) if m["slug"] == slug), None)
    if idx is not None:
        existing_models[idx] = model_entry
    else:
        existing_models.append(model_entry)

    with open(registry_path, "w") as f:
        json.dump(registry, f, indent=2)
    print(f"  registry -> {registry_path}")


# ---------------------------------------------------------------------------
# Main training pipeline
# ---------------------------------------------------------------------------

def train(
    dataset: str,
    algo: str,
    name: str,
    date: str,
    data_dir: Path,
    models_dir: Path,
) -> None:
    if dataset not in DATASET_CONFIG:
        raise ValueError(f"Unknown dataset: {dataset!r}. Choose from {list(DATASET_CONFIG)}")

    slug = slugify(name)
    out_dir = models_dir / dataset
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n{'='*60}")
    print(f"Training: {name}  (slug={slug}, algo={algo})")
    print(f"Dataset : {dataset}")
    print(f"{'='*60}")

    # 1. Load data
    df, feature_cols, label_col = load_dataset(dataset, data_dir)

    X = df[feature_cols].values.astype(np.float32)
    y = df[label_col].values

    # 2. Scale features
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # 3. Stratified train/test split (80/20)
    X_train, X_test, y_train, y_test = train_test_split(
        X_scaled, y, test_size=0.2, random_state=42, stratify=y
    )
    print(f"\n  Train size: {len(X_train)}, Test size: {len(X_test)}")

    # 4. Fit model
    model = build_model(algo)
    print(f"\n  Fitting {model.__class__.__name__}...")
    model.fit(X_train, y_train)

    # 5. Evaluate
    print(f"\n=== Metrics: {dataset} ===")
    metrics = evaluate(model, X_test, y_test)

    # 6. Export all formats
    print(f"\n=== Exports: {slug} ===")
    joblib_file = export_joblib(model, scaler, out_dir, slug)
    pickle_file = export_pickle(model, out_dir, slug)
    onnx_file = export_onnx(model, feature_cols, out_dir, slug)
    pmml_file = export_pmml(model, scaler, feature_cols, out_dir, slug)

    # 7. Write metadata.json
    cfg = DATASET_CONFIG[dataset]
    metadata: dict[str, Any] = {
        "name": name,
        "slug": slug,
        "dataset": dataset,
        "algo": model.__class__.__name__,
        "features": feature_cols,
        "classes": cfg["classes"],
        "metrics": metrics,
        "trained_at": date,
        "formats": {
            "joblib": joblib_file,
            "pickle": pickle_file,
            "onnx": onnx_file,
            "pmml": pmml_file,
        },
        "scaler": "scaler.joblib",
    }
    meta_path = out_dir / "metadata.json"
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2)
    print(f"  metadata -> {meta_path.name}")

    # 8. Upsert registry
    registry_entry: dict[str, Any] = {
        "name": name,
        "slug": slug,
        "algo": model.__class__.__name__,
        "features": feature_cols,
        "classes": cfg["classes"],
        "metrics": metrics,
        "trained_at": date,
        "formats": {
            "joblib": joblib_file,
            "pickle": pickle_file,
            "onnx": onnx_file,
            "pmml": pmml_file,
        },
        "scaler": "scaler.joblib",
    }
    upsert_registry(
        models_dir / "registry.json",
        dataset,
        registry_entry,
    )

    print(f"\nDone. Artifacts in {out_dir}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train and export a scikit-learn model.")
    parser.add_argument("--dataset", required=True, choices=list(DATASET_CONFIG))
    parser.add_argument("--algo", default="random_forest",
                        choices=["random_forest", "decision_tree"])
    parser.add_argument("--name", required=True, help="Display name, e.g. 'FraudGuard v1'")
    parser.add_argument("--date", default="2026-06-23",
                        help="Training date string for metadata (YYYY-MM-DD)")
    parser.add_argument("--data-dir", default="/app/data",
                        help="Root directory containing <dataset>/sample.csv")
    parser.add_argument("--models-dir", default="/app/models",
                        help="Root directory for model output")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    train(
        dataset=args.dataset,
        algo=args.algo,
        name=args.name,
        date=args.date,
        data_dir=Path(args.data_dir),
        models_dir=Path(args.models_dir),
    )
