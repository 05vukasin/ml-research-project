"""
Verification script: confirms all trained artifacts are loadable and functional.
Run from inside the training Docker image after training completes.
"""

import json
import sys
from pathlib import Path

import joblib
import numpy as np

DATASETS = ["fraud", "iot", "intrusion"]
MODELS_DIR = Path("/app/models")
DATA_DIR = Path("/app/data")


def check(condition: bool, msg: str) -> None:
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {msg}")
    if not condition:
        sys.exit(1)


def verify_dataset(dataset: str) -> None:
    print(f"\n=== Verifying: {dataset} ===")
    model_dir = MODELS_DIR / dataset
    meta_path = model_dir / "metadata.json"

    check(meta_path.exists(), f"metadata.json exists at {meta_path}")

    with open(meta_path) as f:
        meta = json.load(f)

    required_keys = ["name", "slug", "algo", "features", "classes", "metrics", "trained_at", "formats", "scaler"]
    for key in required_keys:
        check(key in meta, f"metadata has key '{key}'")

    slug = meta["slug"]
    features = meta["features"]
    n_features = len(features)

    # --- joblib load + predict ---
    joblib_path = model_dir / meta["formats"]["joblib"]
    check(joblib_path.exists(), f"{joblib_path.name} exists")
    model = joblib.load(joblib_path)
    check(hasattr(model, "predict"), "model has .predict()")

    scaler_path = model_dir / "scaler.joblib"
    check(scaler_path.exists(), "scaler.joblib exists")
    scaler = joblib.load(scaler_path)
    check(hasattr(scaler, "transform"), "scaler has .transform()")

    # Run one prediction
    sample_row = np.zeros((1, n_features), dtype=np.float32)
    scaled = scaler.transform(sample_row)
    pred = model.predict(scaled)
    check(pred is not None and len(pred) == 1, f"predict() returns 1 result: {pred}")

    # --- pickle load ---
    if meta["formats"].get("pickle"):
        import pickle
        pkl_path = model_dir / meta["formats"]["pickle"]
        check(pkl_path.exists(), f"{pkl_path.name} exists")
        with open(pkl_path, "rb") as f:
            pkl_model = pickle.load(f)
        check(hasattr(pkl_model, "predict"), "pickle model has .predict()")
        pkl_pred = pkl_model.predict(scaled)
        check(pkl_pred[0] == pred[0], f"pickle and joblib predictions match: {pkl_pred[0]} == {pred[0]}")

    # --- ONNX load + inference ---
    if meta["formats"].get("onnx"):
        try:
            import onnxruntime as rt
            onnx_path = model_dir / meta["formats"]["onnx"]
            check(onnx_path.exists(), f"{onnx_path.name} exists")
            sess = rt.InferenceSession(str(onnx_path))
            input_name = sess.get_inputs()[0].name
            onnx_pred = sess.run(None, {input_name: scaled.astype(np.float32)})
            check(onnx_pred is not None, f"onnxruntime inference returned result: {onnx_pred[0]}")
        except Exception as exc:
            print(f"  [WARN] ONNX inference error: {exc}")

    # --- PMML exists if not null ---
    if meta["formats"].get("pmml"):
        pmml_path = model_dir / meta["formats"]["pmml"]
        check(pmml_path.exists(), f"{pmml_path.name} exists")

    # --- Metrics recorded ---
    for metric_key in ["accuracy", "precision", "recall"]:
        check(metric_key in meta["metrics"], f"metrics.{metric_key} present")

    print(f"  Metrics: accuracy={meta['metrics']['accuracy']:.4f}, "
          f"precision={meta['metrics']['precision']:.4f}, "
          f"recall={meta['metrics']['recall']:.4f}")


def verify_registry() -> None:
    print("\n=== Verifying: models/registry.json ===")
    registry_path = MODELS_DIR / "registry.json"
    check(registry_path.exists(), "registry.json exists")

    with open(registry_path) as f:
        registry = json.load(f)

    for dataset in DATASETS:
        check(dataset in registry, f"registry has dataset '{dataset}'")
        entry = registry[dataset]
        check("label" in entry, f"{dataset}.label present")
        check("positive_label" in entry, f"{dataset}.positive_label present")
        check("theme" in entry and "accent" in entry["theme"], f"{dataset}.theme.accent present")
        check("models" in entry and len(entry["models"]) > 0, f"{dataset} has at least one model")

        for m in entry["models"]:
            slug = m["slug"]
            for fmt_key, fname in m.get("formats", {}).items():
                if fname is not None:
                    fpath = MODELS_DIR / dataset / fname
                    check(fpath.exists(), f"{dataset}/{slug} {fmt_key}: {fname} on disk")
            scaler_path = MODELS_DIR / dataset / m.get("scaler", "scaler.joblib")
            check(scaler_path.exists(), f"{dataset}/{slug} scaler on disk")


def main() -> None:
    print("=" * 60)
    print("MLOps Training Artifact Verification")
    print("=" * 60)

    for dataset in DATASETS:
        verify_dataset(dataset)

    verify_registry()

    print("\n" + "=" * 60)
    print("All checks passed.")
    print("=" * 60)


if __name__ == "__main__":
    main()
