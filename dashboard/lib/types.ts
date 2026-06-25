// Canonical types matching architecture/01-data-flow.md and architecture/03-data-model.md

/** Live SSE event from GET /stream */
export interface StreamEvent {
  id: number;
  dataset: string;
  prediction: 0 | 1;
  actual: 0 | 1;
  is_correct: boolean;
  probability: number;
  latency_ms: number;
  ts: string;
  /** True for the on-connect snapshot event (seeds aggregates, not a real prediction). */
  snapshot?: boolean;
  running_accuracy: number;
  total_processed: number;
  positive_count: number;
  throughput: number;
  avg_latency: number;
}

/** Latest aggregates derived from the stream — updated on every flush */
export interface StreamAggregates {
  running_accuracy: number;
  total_processed: number;
  positive_count: number;
  throughput: number;
  avg_latency: number;
  dataset: string;
}

export type ConnectionStatus = "connected" | "connecting" | "disconnected";

/** Model entry in registry.json */
export interface RegistryModel {
  name: string;
  slug: string;
  algo: string;
  features: string[];
  classes: Record<string, string>;
  metrics: {
    accuracy: number;
    precision: number;
    recall: number;
  };
  trained_at: string;
  formats: {
    joblib: string | null;
    pickle: string | null;
    onnx: string | null;
    pmml: string | null;
  };
  scaler: string;
}

/** Dataset entry in registry.json */
export interface RegistryDataset {
  label: string;
  positive_label: string;
  theme: {
    accent: string;
  };
  models: RegistryModel[];
}

/** Full registry.json shape */
export type Registry = Record<string, RegistryDataset>;

/** GET /health response */
export interface HealthResponse {
  status: string;
  active_dataset: string;
  active_model: string;
  models_loaded: number;
}

/** GET /metrics?dataset= accuracy_over_time item */
export interface AccuracyPoint {
  ts: string;
  accuracy: number;
  count: number;
}

/** GET /metrics?dataset= full response — matches actual inference API */
export interface MetricsResponse {
  dataset: string;
  total: number;
  accuracy: number;
  confusion: {
    tp: number;
    fp: number;
    tn: number;
    fn: number;
  };
  avg_latency_ms: number;
  p95_latency_ms: number;
  throughput_per_sec: number;
  accuracy_over_time: AccuracyPoint[];
  // Optional fields that may be in some response versions
  precision?: number;
  recall?: number;
  positive_count?: number;
}

/** POST /control payload */
export interface ControlPayload {
  interval_ms?: number;
  paused?: boolean;
  dataset?: string;
  model?: string;
}

/** GET /progress?dataset= response */
export interface ProgressResponse {
  dataset: string;
  rows_processed: number;
  total_rows: number;
  percent: number;
}

// ── Trainer types ────────────────────────────────────────────────────

/** GET trainer:/algos item */
export interface AlgoOption {
  id: string;
  label: string;
}

/** POST trainer:/train payload */
export interface TrainPayload {
  dataset: string;
  algo: string;
  name: string;
  /** Fraction of dataset to use for training (0.0–1.0); defaults to 1.0 server-side */
  train_fraction?: number;
}

/** POST trainer:/train response */
export interface TrainResponse {
  job_id: string;
}

/** SSE event from GET trainer:/train/stream?job_id= */
export interface TrainProgressEvent {
  step?: number;
  total?: number;
  accuracy: number;
  /** "training" during the run; "done" on completion; "error" on failure */
  status: "training" | "done" | "error";
  // Present on final "done" event
  precision?: number;
  recall?: number;
  dataset?: string;
  slug?: string;
  formats?: Record<string, string | null>;
  name?: string;
  error?: string;
  /** Fraction of dataset used for training (0.0–1.0) */
  train_fraction?: number | null;
}

// ── v2 Model catalog types ────────────────────────────────────────────

/**
 * Shape of each entry in GET /models[?dataset=]
 * Includes an optional `last_run` summary block.
 */
export interface ModelRunSummary {
  id: number;
  started_at: string;
  ended_at: string | null;
  total: number;
  correct: number;
  accuracy: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  throughput_per_sec: number;
}

export interface ModelCatalogEntry {
  id: number;
  dataset: string;
  slug: string;
  name: string;
  algo: string;
  accuracy: number;
  precision: number;
  recall: number;
  /** Fraction of data used during training; null for seeded models */
  train_fraction: number | null;
  trained_at: string;
  formats: {
    joblib: string | null;
    pickle: string | null;
    onnx: string | null;
    pmml: string | null;
  };
  features: string[];
  source: string;
  created_at: string;
  updated_at: string;
  /** Included on catalog list; absent on detail endpoint */
  last_run?: ModelRunSummary | null;
}

/**
 * In-flight training job surfaced from the Training Lab to the model catalog so
 * the model being trained shows as a live "loading" card at the top of the list.
 * Ephemeral (in-memory only) — gone on reload, replaced by a real card when done.
 */
export interface PendingTrainingJob {
  name: string;
  slug: string;
  dataset: string;
  algo: string;
  /** 0..1 */
  trainFraction: number;
  status: "running" | "done";
  step: number;
  total: number;
  accuracy: number;
}

/**
 * Shape of each entry in GET /models/{dataset}/{slug}/runs
 * Includes confusion matrix + is_last flag.
 */
export interface ModelRun {
  id: number;
  dataset: string;
  model_slug: string;
  started_at: string;
  ended_at: string | null;
  total: number;
  correct: number;
  accuracy: number;
  confusion: {
    tp: number;
    fp: number;
    tn: number;
    fn: number;
  };
  avg_latency_ms: number;
  p95_latency_ms: number;
  throughput_per_sec: number;
  is_last: boolean;
}

/**
 * Shape of GET /models/{dataset}/{slug}/last-run
 * Wraps the run object in a { run } envelope.
 */
export interface LastRunResponse {
  run: ModelRun | null;
}

/**
 * Shape of GET /models/{dataset}/{slug}/current-run
 * Live in-progress stats (no ended_at; has elapsed_s).
 */
export interface CurrentRun {
  dataset: string;
  model_slug: string;
  started_at: string;
  total: number;
  correct: number;
  accuracy: number;
  confusion: {
    tp: number;
    fp: number;
    tn: number;
    fn: number;
  };
  avg_latency_ms: number;
  p95_latency_ms: number;
  throughput_per_sec: number;
  elapsed_s: number;
}

/** GET /models/{dataset}/{slug}/current-run response envelope */
export interface CurrentRunResponse {
  current_run: CurrentRun | null;
}

// ── Monitoring snapshot ───────────────────────────────────────────────

export interface MonitoringSnapshot {
  postgres: {
    status: "ok" | "error";
    db_size_mb: number;
    predictions_total: number;
    predictions_by_dataset: Record<string, number>;
    connections: number;
  };
  redis: {
    status: "ok" | "error";
    version: string;
    used_memory_mb: number;
    connected_clients: number;
    ops_per_sec: number;
    pubsub: Record<string, number>;
  };
  streamer: {
    status: "ok" | "unknown" | "error";
    reason?: string;
  };
  inference: {
    status: "ok" | "error";
    models_loaded: number;
    active_dataset: string;
    active_model: string;
    throughput: number;
    avg_latency_ms: number;
    sse_subscribers: number;
    uptime_s: number;
  };
}

// ── Trainer stats ─────────────────────────────────────────────────────

/** GET trainer:/health — minimal response (no /stats endpoint exists yet) */
export interface TrainerStats {
  status: string;
}
