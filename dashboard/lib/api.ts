/**
 * API client — reads NEXT_PUBLIC_INFERENCE_URL and NEXT_PUBLIC_TRAINER_URL from env.
 * All functions are plain async fetches (no caching primitives needed here;
 * polling is done by the client components themselves).
 */
import type {
  HealthResponse,
  MetricsResponse,
  ProgressResponse,
  Registry,
  ControlPayload,
  TrainPayload,
  TrainResponse,
  AlgoOption,
  ModelCatalogEntry,
  ModelRun,
  LastRunResponse,
  CurrentRunResponse,
  MonitoringSnapshot,
  TrainerStats,
} from "./types";

const BASE =
  process.env.NEXT_PUBLIC_INFERENCE_URL ?? "http://localhost:8000";

const TRAINER =
  process.env.NEXT_PUBLIC_TRAINER_URL ?? "http://localhost:8001";

/** Build the SSE stream URL — used by useLiveStream hook */
export function streamUrl(): string {
  return `${BASE}/stream`;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${BASE}/health`, { cache: "no-store" });
  if (!res.ok) throw new Error(`/health ${res.status}`);
  return res.json();
}

export async function fetchRegistry(): Promise<Registry> {
  const res = await fetch(`${BASE}/registry`, { cache: "no-store" });
  if (!res.ok) throw new Error(`/registry ${res.status}`);
  const body = await res.json();
  // Inference wraps: { registry: {...}, active_dataset, active_model }
  return (body.registry ?? body) as Registry;
}

export async function fetchMetrics(dataset: string): Promise<MetricsResponse> {
  const res = await fetch(`${BASE}/metrics?dataset=${encodeURIComponent(dataset)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`/metrics ${res.status}`);
  return res.json();
}

export async function postControl(payload: ControlPayload): Promise<void> {
  const res = await fetch(`${BASE}/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`/control ${res.status}`);
}

/** Export model — returns a Blob for download */
export function modelExportUrl(
  dataset: string,
  slug: string,
  format: string
): string {
  return `${BASE}/models/${encodeURIComponent(dataset)}/${encodeURIComponent(slug)}/export?format=${encodeURIComponent(format)}`;
}

/** GET /progress?dataset= — dataset row processing progress */
export async function fetchProgress(dataset: string): Promise<ProgressResponse> {
  const res = await fetch(
    `${BASE}/progress?dataset=${encodeURIComponent(dataset)}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error(`/progress ${res.status}`);
  return res.json();
}

// ── Trainer API ─────────────────────────────────────────────────────

/** GET trainer:/algos — available training algorithms */
export async function fetchAlgos(): Promise<AlgoOption[]> {
  const res = await fetch(`${TRAINER}/algos`, { cache: "no-store" });
  if (!res.ok) throw new Error(`/algos ${res.status}`);
  return res.json();
}

// ── v2 Model catalog API ──────────────────────────────────────────────

/**
 * GET /models[?dataset=] — catalog of all (or filtered) models.
 * Each entry includes a `last_run` summary if one exists.
 */
export async function fetchModels(dataset?: string): Promise<ModelCatalogEntry[]> {
  const url = dataset
    ? `${BASE}/models?dataset=${encodeURIComponent(dataset)}`
    : `${BASE}/models`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`/models ${res.status}`);
  return res.json();
}

/** GET /models/{dataset}/{slug} — single model detail (no last_run) */
export async function fetchModelDetail(
  dataset: string,
  slug: string
): Promise<ModelCatalogEntry> {
  const res = await fetch(
    `${BASE}/models/${encodeURIComponent(dataset)}/${encodeURIComponent(slug)}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error(`/models/${dataset}/${slug} ${res.status}`);
  return res.json();
}

/** GET /models/{dataset}/{slug}/runs — list of completed runs */
export async function fetchModelRuns(
  dataset: string,
  slug: string
): Promise<ModelRun[]> {
  const res = await fetch(
    `${BASE}/models/${encodeURIComponent(dataset)}/${encodeURIComponent(slug)}/runs`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error(`/models/${dataset}/${slug}/runs ${res.status}`);
  return res.json();
}

/** GET /models/{dataset}/{slug}/last-run — most recent completed run or null */
export async function fetchLastRun(
  dataset: string,
  slug: string
): Promise<LastRunResponse> {
  const res = await fetch(
    `${BASE}/models/${encodeURIComponent(dataset)}/${encodeURIComponent(slug)}/last-run`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error(`/models/${dataset}/${slug}/last-run ${res.status}`);
  return res.json();
}

/** GET /models/{dataset}/{slug}/current-run — live in-progress stats or null */
export async function fetchCurrentRun(
  dataset: string,
  slug: string
): Promise<CurrentRunResponse> {
  const res = await fetch(
    `${BASE}/models/${encodeURIComponent(dataset)}/${encodeURIComponent(slug)}/current-run`,
    { cache: "no-store" }
  );
  if (!res.ok)
    throw new Error(`/models/${dataset}/${slug}/current-run ${res.status}`);
  return res.json();
}

/** GET /monitoring — postgres, redis, streamer, inference health snapshot */
export async function fetchMonitoring(): Promise<MonitoringSnapshot> {
  const res = await fetch(`${BASE}/monitoring`, { cache: "no-store" });
  if (!res.ok) throw new Error(`/monitoring ${res.status}`);
  return res.json();
}

// ── Trainer API v2 ────────────────────────────────────────────────────

/** GET trainer:/health — minimal trainer health (no /stats endpoint) */
export async function fetchTrainerStats(): Promise<TrainerStats> {
  const res = await fetch(`${TRAINER}/health`, { cache: "no-store" });
  if (!res.ok) throw new Error(`trainer /health ${res.status}`);
  return res.json();
}

/** POST trainer:/train — start a training job */
export async function postTrain(payload: TrainPayload): Promise<TrainResponse> {
  const res = await fetch(`${TRAINER}/train`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`/train ${res.status}: ${text}`);
  }
  return res.json();
}

/** Build the SSE URL for a training job's live progress stream */
export function trainStreamUrl(jobId: string): string {
  return `${TRAINER}/train/stream?job_id=${encodeURIComponent(jobId)}`;
}
