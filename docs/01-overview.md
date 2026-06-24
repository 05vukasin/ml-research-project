# Overview

## The problem

In a production ML system, a model classifies a continuous stream of events — transactions,
sensor readings, network packets — and operators need to see in real time how accurate it is.
Most monitoring dashboards fake this metric or compute it from batch jobs with minutes of lag.

This system computes a **real** running accuracy: every dataset ships with ground-truth labels,
the streamer includes the label in every message, and inference computes `is_correct =
prediction == actual` per event. The hero metric on the dashboard is the cumulative
`correct / total`, updated live on every prediction.

## The three domains

| Slug | Domain | Data source | Positive class | Committed model |
|---|---|---|---|---|
| `fraud` | Credit card fraud detection | Kaggle: Credit Card Fraud Detection | Fraud transaction | FraudGuard v1 |
| `iot` | Predictive machine maintenance | Kaggle: AI4I 2020 Predictive Maintenance | Equipment failure | RotorMind v1 |
| `intrusion` | Network intrusion detection | Kaggle: NSL-KDD | Attack traffic | NetGuard v1 |

All three use the same architecture, column contract, and inference path. The repo ships
synthetic sample data for all three so the system runs offline. See
[04-getting-started.md](04-getting-started.md) for how to swap in the real Kaggle datasets.

## Goals

- One command starts the full stack (`docker compose up --build`).
- The serving path never trains — models are pre-trained, serialized, and loaded at startup.
- Multiple datasets and models, switchable live from the UI without restarting any container.
- A live Training Lab where you can train a new model, watch accuracy climb, then use it.
- Model export in joblib, pickle, ONNX, and PMML, downloadable from the UI.
- A modern animated dashboard that makes the live pipeline visible.

## Feature tour

### Dashboard tab

The main tab shows the accuracy gauge, an animated React Flow pipeline diagram, a live
prediction feed, KPI cards (total processed, running accuracy, avg latency, throughput),
metrics charts (accuracy over time, confusion matrix, latency distribution), a dataset
progress widget, and a benchmark surface comparing the active model's current run with
its last saved run.

![Dashboard tab](img/dashboard.png)

### Training Lab tab

Pick a dataset, algorithm (Random Forest or SGD), and training fraction (5%–100%). Type a
model name and click Train. The trainer fits the model incrementally and streams progress
over SSE — accuracy climbs on the live curve as each batch of estimators is added. When
training completes, the model is exported, registered, and immediately available in the
settings popup and model cards.

![Training Lab](img/training-lab.png)

### Settings popup

Open the gear icon (top-right) to switch dataset or model live, adjust stream speed, or
pause/resume the stream. Download the active model in any available format.

![Settings popup](img/model-settings.png)

### Monitoring tab

Four half-width service cards (postgres, inference, trainer, streamer) show live status and
key stats. A full-width Redis panel shows pubsub subscriber counts, a throughput sparkline,
memory usage, connected clients, and ops/sec. The streamer card reads the `streamer:heartbeat`
Redis key — stop the streamer container and the card flips to `down` within 6 seconds.

![Monitoring tab](img/monitoring.png)

## Glossary

| Term | Definition |
|---|---|
| Running accuracy | Cumulative `correct / total` predictions vs ground-truth labels |
| Active dataset | The dataset currently being streamed and scored |
| Active model | The model currently selected for the active dataset |
| Model registry | `models/registry.json` — indexes every trained model and its export formats |
| Control channel | Redis `control` channel carrying speed/pause/dataset/model commands from the UI |
| Positive class | The "interesting" label per dataset: Fraud / Failure / Attack |
| Benchmark run | A `model_runs` row recording accuracy, latency, and confusion stats for one active-model window |
| Seeded model | A pre-trained model committed to the repo (`source='seeded'` in the catalog) |
| Trained model | A model produced by the trainer service at user request (`source='trained'`) |
| train_fraction | The fraction of the dataset used for training (0.05–1.0); `test_size = 1 - train_fraction` |

See [02-architecture.md](02-architecture.md) for the system diagram and container details.
