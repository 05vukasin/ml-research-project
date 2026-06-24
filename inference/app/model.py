"""
Model registry loader.

Reads MODELS_DIR/registry.json at startup and joblib.loads every model + scaler
into memory, keyed by (dataset, slug).  Active dataset/model tracking lives here.

Rules:
- NEVER calls .fit() — prediction only.
- Fails loudly at startup if any referenced file is missing.
- reload() is thread-safe: uses a threading.Lock during the swap.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import joblib
import numpy as np

logger = logging.getLogger(__name__)

# ── Types ──────────────────────────────────────────────────────────────────────
ModelKey = Tuple[str, str]  # (dataset_slug, model_slug)


class ModelStore:
    """Thread-safe in-memory store of loaded models and scalers."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        # {(dataset, slug): {"model": ..., "scaler": ..., "features": [...]}}
        self._store: Dict[ModelKey, Dict[str, Any]] = {}
        self._registry: Dict[str, Any] = {}
        self._active_dataset: str = ""
        self._active_model: str = ""
        self._models_dir: Path = Path("/models")

    # ── Startup load ───────────────────────────────────────────────────────────

    def load_all(self, models_dir: str, start_dataset: str = "fraud") -> None:
        """Load every model+scaler referenced in registry.json. Fail loudly if any file is missing."""
        self._models_dir = Path(models_dir)
        registry_path = self._models_dir / "registry.json"

        if not registry_path.exists():
            raise FileNotFoundError(f"registry.json not found at {registry_path}")

        with registry_path.open() as f:
            registry: Dict[str, Any] = json.load(f)

        new_store: Dict[ModelKey, Dict[str, Any]] = {}

        for dataset_slug, dataset_info in registry.items():
            for model_meta in dataset_info.get("models", []):
                slug: str = model_meta["slug"]
                model_path = self._models_dir / dataset_slug / model_meta["formats"]["joblib"]
                scaler_path = self._models_dir / dataset_slug / model_meta["scaler"]

                if not model_path.exists():
                    raise FileNotFoundError(
                        f"Model file missing: {model_path}. "
                        "Run training before starting inference."
                    )
                if not scaler_path.exists():
                    raise FileNotFoundError(
                        f"Scaler file missing: {scaler_path}. "
                        "Run training before starting inference."
                    )

                model = joblib.load(model_path)
                scaler = joblib.load(scaler_path)

                # Safety check — must not expose a fit() surface at runtime
                if hasattr(model, "fit") and callable(model.fit):
                    # That's fine for the class; we just never call it.
                    pass

                new_store[(dataset_slug, slug)] = {
                    "model": model,
                    "scaler": scaler,
                    "features": model_meta["features"],
                    "meta": model_meta,
                }
                logger.info("Loaded model (%s, %s) from %s", dataset_slug, slug, model_path)

        # Determine defaults
        if start_dataset not in registry:
            start_dataset = next(iter(registry))
        first_slug = registry[start_dataset]["models"][0]["slug"]

        with self._lock:
            self._store = new_store
            self._registry = registry
            self._active_dataset = start_dataset
            self._active_model = first_slug

        logger.info(
            "Model store ready: %d models, active=(%s, %s)",
            len(new_store),
            start_dataset,
            first_slug,
        )

    # ── Hot-reload (called by POST /reload) ────────────────────────────────────

    def reload(self) -> int:
        """
        Re-read registry.json and load any new or updated models.
        Existing active selection is kept if still valid; otherwise falls back to first.
        Returns total models loaded.
        """
        registry_path = self._models_dir / "registry.json"
        if not registry_path.exists():
            raise FileNotFoundError(f"registry.json not found at {registry_path}")

        with registry_path.open() as f:
            registry: Dict[str, Any] = json.load(f)

        new_store: Dict[ModelKey, Dict[str, Any]] = {}

        for dataset_slug, dataset_info in registry.items():
            for model_meta in dataset_info.get("models", []):
                slug: str = model_meta["slug"]
                model_path = self._models_dir / dataset_slug / model_meta["formats"]["joblib"]
                scaler_path = self._models_dir / dataset_slug / model_meta["scaler"]

                if not model_path.exists():
                    raise FileNotFoundError(f"Model file missing: {model_path}")
                if not scaler_path.exists():
                    raise FileNotFoundError(f"Scaler file missing: {scaler_path}")

                model = joblib.load(model_path)
                scaler = joblib.load(scaler_path)
                new_store[(dataset_slug, slug)] = {
                    "model": model,
                    "scaler": scaler,
                    "features": model_meta["features"],
                    "meta": model_meta,
                }
                logger.info("Reloaded model (%s, %s)", dataset_slug, slug)

        with self._lock:
            prev_dataset = self._active_dataset
            prev_model = self._active_model
            self._store = new_store
            self._registry = registry
            # Keep active selection if still valid
            if (prev_dataset, prev_model) not in new_store:
                fallback_ds = next(iter(registry))
                fallback_slug = registry[fallback_ds]["models"][0]["slug"]
                self._active_dataset = fallback_ds
                self._active_model = fallback_slug
                logger.warning(
                    "Previous active (%s, %s) gone after reload; falling back to (%s, %s)",
                    prev_dataset,
                    prev_model,
                    fallback_ds,
                    fallback_slug,
                )

        return len(new_store)

    # ── Prediction ─────────────────────────────────────────────────────────────

    def predict(
        self,
        dataset: str,
        model_slug: str,
        features: Dict[str, Any],
    ) -> Tuple[int, float]:
        """
        Scale features then call predict + predict_proba.
        Returns (label: int, probability_of_positive_class: float).
        Never calls .fit().
        """
        with self._lock:
            entry = self._store.get((dataset, model_slug))

        if entry is None:
            raise KeyError(f"No loaded model for ({dataset}, {model_slug})")

        feature_names: list[str] = entry["features"]
        try:
            X = np.array([[features[f] for f in feature_names]], dtype=float)
        except KeyError as exc:
            raise ValueError(f"Missing feature in payload: {exc}") from exc

        scaler = entry["scaler"]
        model = entry["model"]

        X_scaled = scaler.transform(X)
        label: int = int(model.predict(X_scaled)[0])
        proba: float = float(model.predict_proba(X_scaled)[0][1])

        return label, proba

    # ── Active selection ───────────────────────────────────────────────────────

    def set_active(self, dataset: Optional[str], model_slug: Optional[str]) -> None:
        """Switch active dataset/model. Validates against loaded store."""
        with self._lock:
            new_dataset = dataset if dataset is not None else self._active_dataset
            # When dataset changes without explicit model, pick first model of that dataset
            if dataset is not None and model_slug is None:
                candidates = [s for (d, s) in self._store if d == dataset]
                if not candidates:
                    raise ValueError(f"No models loaded for dataset '{dataset}'")
                new_slug = candidates[0]
            else:
                new_slug = model_slug if model_slug is not None else self._active_model

            if (new_dataset, new_slug) not in self._store:
                raise ValueError(f"Unknown model ({new_dataset}, {new_slug})")

            self._active_dataset = new_dataset
            self._active_model = new_slug

    @property
    def active_dataset(self) -> str:
        with self._lock:
            return self._active_dataset

    @property
    def active_model(self) -> str:
        with self._lock:
            return self._active_model

    @property
    def registry(self) -> Dict[str, Any]:
        with self._lock:
            return self._registry

    def known_datasets(self) -> set[str]:
        with self._lock:
            return {d for (d, _) in self._store}

    def known_models(self, dataset: str) -> set[str]:
        with self._lock:
            return {s for (d, s) in self._store if d == dataset}

    def get_model_meta(self, dataset: str, slug: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            entry = self._store.get((dataset, slug))
            return entry["meta"] if entry else None

    def models_loaded_count(self) -> int:
        with self._lock:
            return len(self._store)


# Module-level singleton
store = ModelStore()
