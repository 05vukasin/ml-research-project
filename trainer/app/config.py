"""
Configuration for the trainer service.
All config via env vars — no hardcoded values.
"""

import os
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
MODELS_DIR: Path = Path(os.environ.get("MODELS_DIR", "/models"))
DATA_DIR: Path = Path(os.environ.get("DATA_DIR", "/data"))

# ---------------------------------------------------------------------------
# Inference service URL (for hot-reload after training)
# ---------------------------------------------------------------------------
INFERENCE_URL: str = os.environ.get("INFERENCE_URL", "http://inference:8000")

# ---------------------------------------------------------------------------
# Database URL (for persisting trained-model metadata to the models table)
# ---------------------------------------------------------------------------
DATABASE_URL: str = os.environ.get(
    "DATABASE_URL",
    "postgresql+psycopg://mlops:mlops@postgres:5432/mlops",
)

# ---------------------------------------------------------------------------
# Dataset configuration (mirrors training/train.py DATASET_CONFIG)
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

VALID_DATASETS: frozenset[str] = frozenset(DATASET_CONFIG.keys())
VALID_ALGOS: frozenset[str] = frozenset({"random_forest", "sgd"})

# ---------------------------------------------------------------------------
# Available algorithms for /algos endpoint
# ---------------------------------------------------------------------------
ALGOS: list[dict[str, str]] = [
    {"id": "random_forest", "label": "Random Forest"},
    {"id": "sgd", "label": "SGD (logistic)"},
]
