# Getting Started

## Prerequisites

- Docker Engine 24+ and Docker Compose v2 (`docker compose` not `docker-compose`).
- Ports 3000, 8000, 8001, 5432, and 6379 available on the host.

No other local dependencies. Python, Node, and all libraries are installed inside the containers.

---

## One-command run

```bash
cp .env.example .env
docker compose up --build
```

The first build takes several minutes — Python wheels and the Next.js bundle are compiled
inside the containers. Subsequent `docker compose up` calls are fast.

Wait for all six containers to reach a healthy state. You'll see inference log
`"Inference service startup complete"` and the dashboard container pass its healthcheck.

| Service | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| Inference API | http://localhost:8000/health |
| Trainer API | http://localhost:8001/health |

---

## Environment variables

Copy `.env.example` to `.env` before running. All config is read from `.env` at compose time.
Do not commit `.env` — it may contain credentials.

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_USER` | `mlops` | PostgreSQL user |
| `POSTGRES_PASSWORD` | `mlops_secret_change_me` | PostgreSQL password — change before production use |
| `POSTGRES_DB` | `mlops` | PostgreSQL database name |
| `POSTGRES_PORT` | `5432` | Host port mapped to PostgreSQL |
| `DATABASE_URL` | `postgresql+psycopg2://mlops:mlops_secret_change_me@postgres:5432/mlops` | DSN used by the inference service (psycopg2 driver) |
| `REDIS_PORT` | `6379` | Host port mapped to Redis |
| `REDIS_URL` | `redis://redis:6379/0` | Redis connection URL (container-internal) |
| `MODELS_DIR` | `/models` | Path to model artifacts inside containers |
| `DATA_DIR` | `/data` | Path to dataset CSVs inside containers |
| `START_DATASET` | `fraud` | Dataset the streamer starts on (`fraud` / `iot` / `intrusion`) |
| `START_INTERVAL_MS` | `500` | Initial publish interval in milliseconds |
| `INFERENCE_PORT` | `8000` | Host port mapped to the inference service |
| `TRAINER_PORT` | `8001` | Host port mapped to the trainer service |
| `INFERENCE_URL` | `http://inference:8000` | URL the trainer uses to call inference `/reload` (container-internal) |
| `DASHBOARD_PORT` | `3000` | Host port mapped to the dashboard |
| `NEXT_PUBLIC_INFERENCE_URL` | `http://localhost:8000` | Browser-reachable inference URL (baked into the Next.js bundle at build time) |
| `NEXT_PUBLIC_TRAINER_URL` | `http://localhost:8001` | Browser-reachable trainer URL (baked into the Next.js bundle at build time) |

**Note on trainer DSN:** the trainer service constructs its own psycopg3 DSN from `POSTGRES_*`
vars at compose time (`postgresql+psycopg://<user>:<password>@postgres:5432/<db>`). You do not
need a separate `TRAINER_DATABASE_URL` variable in `.env`.

---

## Stop the stack

```bash
docker compose down       # stop containers, keep the postgres volume
docker compose down -v    # stop and delete the postgres volume (clears all prediction history)
```

---

## Swapping in the real Kaggle datasets

The repo ships synthetic sample data at `data/<slug>/sample.csv`. These files run the full
system offline. To use the real public datasets, follow the column contract below, replace
the sample file, retrain, and rebuild.

### fraud — Credit Card Fraud Detection

Dataset: https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud (`creditcard.csv`)

Required columns after renaming:

| Original column | Rename to |
|---|---|
| `Time` | `hour` |
| `V1` | `v1` |
| `V2` | `v2` |
| `V3` | `v3` |
| `V4` | `v4` |
| `V5` | `v5` |
| `V6` | `v6` |
| `Amount` | `amount` |
| `Class` | `is_fraud` |

Drop all other V columns (`V7`–`V28`).

### iot — AI4I 2020 Predictive Maintenance

Dataset: https://www.kaggle.com/datasets/shivamb/machine-predictive-maintenance-classification

Required columns after renaming:

| Original column | Rename to |
|---|---|
| `Air temperature [K]` | `air_temp` |
| `Process temperature [K]` | `process_temp` |
| `Rotational speed [rpm]` | `rotational_speed` |
| `Torque [Nm]` | `torque` |
| `Tool wear [min]` | `tool_wear` |
| `Machine failure` | `failure` |

Collapse all failure sub-type columns (`TWF`, `HDF`, `PWF`, `OSF`, `RNF`) into the single
binary `failure` column (0 = ok, 1 = any failure). Drop the sub-type columns.

### intrusion — NSL-KDD

Dataset: https://www.kaggle.com/datasets/hassan06/nslkdd (use `KDDTrain+.txt`)

Required columns:

| Column | Notes |
|---|---|
| `duration` | keep as-is |
| `src_bytes` | keep as-is |
| `dst_bytes` | keep as-is |
| `count` | keep as-is |
| `srv_count` | keep as-is |
| `protocol` | encode `protocol_type` as integer |
| `flag` | encode `flag` as integer |
| `attack` | rename original label: 0 = normal, 1 = attack |

### After replacing the CSV

```bash
cd training
python train.py --dataset <slug> --algo random_forest --name "<Model Name>"
docker compose up --build
```

No code changes required. The streamer reads columns by name using `registry.json` as the
feature list; inference reads the same list at startup.

---

## Troubleshooting

**Port 3000 is already in use.**

Set a different host port in `.env`:
```
DASHBOARD_PORT=3001
```
Then access the dashboard at http://localhost:3001.

The same pattern applies to any other port conflict (`INFERENCE_PORT`, `TRAINER_PORT`,
`POSTGRES_PORT`, `REDIS_PORT`). Note that `NEXT_PUBLIC_INFERENCE_URL` and
`NEXT_PUBLIC_TRAINER_URL` must still point to the correct host ports — they are baked into
the Next.js bundle at build time.

**psycopg2 vs psycopg3 DSN mismatch.**

The inference service uses `psycopg2-binary` and requires `DATABASE_URL` to start with
`postgresql+psycopg2://`. The trainer constructs its own psycopg3 DSN internally from
`POSTGRES_*` vars (`postgresql+psycopg://`). Do not change the `DATABASE_URL` prefix — the
wrong driver prefix causes a SQLAlchemy dialect error at startup.

**PMML download button is greyed out.**

The trainer image ships a JRE, but `sklearn2pmml` fails to convert on this scikit-learn version,
so PMML is exported as `null` in `registry.json` and disabled in the UI. To enable PMML: pin a
compatible `sklearn2pmml`/scikit-learn pairing in `trainer/Dockerfile`, then retrain. See [07-ml-lifecycle.md](07-ml-lifecycle.md).

**Inference fails to start ("models missing").**

The `models/` directory is mounted read-only into inference. Ensure `models/registry.json`
exists and all files listed under `formats` for each model are present in `models/<dataset>/`.
Run `ls models/fraud/` to verify. The committed models are part of the repo and should be
present after cloning.

**Dashboard shows "Connection lost" or the accuracy gauge is stuck.**

The SSE connection to `GET /stream` dropped. Check that inference is running:
`docker compose ps` and `curl http://localhost:8000/health`. Reload the browser to reconnect.
The dashboard reconnects automatically after a brief backoff.

**Streamer card shows `down` in the Monitoring tab.**

This is expected if the streamer container is stopped. If the streamer is running, check
its logs: `docker compose logs streamer`. A missing `data/<slug>/sample.csv` causes the
streamer to exit at startup.
