"use client";

/**
 * TrainingLab — T39 + T50
 *
 * Dedicated section for kicking off a training job and watching accuracy climb live.
 *
 * Flow:
 *  1. Form: dataset select, algo select (GET trainer:/algos), model name input,
 *     train-fraction slider (5–100%, default 70%) — T50
 *  2. Train button → POST trainer:/train → job_id (with train_fraction) — T50
 *  3. Open SSE to GET trainer:/train/stream?job_id=
 *     - Buffer events and flush on rAF (realtime-ui pattern)
 *     - Animated segmented progress bar + live step/accuracy + ETA — T50
 *     - Animate live accuracy curve with Recharts AreaChart
 *  4. On "done" event: show final metrics including train_fraction; refresh
 *     /registry and fetchModels so new model appears in cards — T50
 *
 * Error handling: trainer down, bad job_id, stream error — all surfaced gracefully.
 * Respects prefers-reduced-motion.
 */
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useTransition,
} from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Loader2, Play, CheckCircle2, AlertCircle, Zap } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useDashboard } from "@/context/DashboardContext";
import { fetchAlgos, postTrain, trainStreamUrl, fetchRegistry } from "@/lib/api";
import type { AlgoOption, TrainProgressEvent, PendingTrainingJob } from "@/lib/types";

/** Kebab-case a model name the same way the trainer does, for catalog dedup. */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────

interface AccuracyPoint {
  step: number;
  accuracy: number;
}

interface JobResult {
  accuracy: number;
  precision?: number;
  recall?: number;
  slug?: string;
  name?: string;
  train_fraction?: number | null;
}

type JobStatus = "idle" | "starting" | "running" | "done" | "error";

// ── Sub-components ────────────────────────────────────────────────

/** Hint copy for the train_fraction slider */
function fractionHint(pct: number): string {
  if (pct <= 20) return "Very fast run · low accuracy";
  if (pct <= 40) return "Faster training · less accurate";
  if (pct <= 70) return "Balanced speed / accuracy";
  if (pct < 100) return "High accuracy · slower";
  return "Full dataset · best accuracy";
}

interface SegmentedProgressProps {
  /** 0–100 */
  percent: number;
  accent: string;
  reducedMotion: boolean;
}

/**
 * Animated segmented progress bar.
 * Segments fill left-to-right via scaleX (transform only — no width animation).
 * Respects prefers-reduced-motion: sets duration to 0.
 */
function SegmentedProgress({ percent, accent, reducedMotion }: SegmentedProgressProps) {
  const SEGMENTS = 20;
  const filledCount = Math.round((percent / 100) * SEGMENTS);

  return (
    <div
      className="flex gap-0.5 w-full"
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Training progress"
    >
      {Array.from({ length: SEGMENTS }, (_, i) => {
        const isFilled = i < filledCount;
        return (
          <motion.div
            key={i}
            className="h-2 flex-1 rounded-sm origin-left"
            style={{
              backgroundColor: isFilled ? accent : undefined,
            }}
            initial={false}
            animate={{
              scaleX: isFilled ? 1 : 0.15,
              opacity: isFilled ? 1 : 0.2,
            }}
            transition={
              reducedMotion
                ? { duration: 0 }
                : { type: "spring", stiffness: 180, damping: 22, delay: i * 0.012 }
            }
          />
        );
      })}
    </div>
  );
}

interface LiveCurveProps {
  points: AccuracyPoint[];
  accent: string;
}

function LiveCurve({ points, accent }: LiveCurveProps) {
  if (points.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-xs text-muted-foreground">
        Accuracy curve will appear here once training starts
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={points} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="gradTrain" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={accent} stopOpacity={0.2} />
            <stop offset="95%" stopColor={accent} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis
          dataKey="step"
          label={{ value: "step", position: "insideBottom", offset: -2, fontSize: 9, fill: "#94a3b8" }}
          tick={{ fontSize: 9, fill: "#94a3b8" }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          domain={[0, 1]}
          tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
          tick={{ fontSize: 9, fill: "#94a3b8" }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={{
            fontSize: 11,
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(v: any) => [`${(Number(v) * 100).toFixed(2)}%`, "Accuracy"]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          labelFormatter={(label: any) => `Step ${label}`}
        />
        <Area
          type="monotone"
          dataKey="accuracy"
          stroke={accent}
          strokeWidth={2}
          fill="url(#gradTrain)"
          dot={false}
          activeDot={{ r: 4, fill: accent }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Main component ────────────────────────────────────────────────

export function TrainingLab({
  onModelsTrained,
  onJobChange,
}: {
  onModelsTrained?: () => void;
  onJobChange?: (job: PendingTrainingJob | null) => void;
} = {}) {
  const { registry, activeDataset, setRegistry } = useDashboard();
  const reducedMotion = useReducedMotion() ?? false;

  // Form state
  const [dataset, setDataset] = useState(activeDataset ?? "fraud");
  const [algo, setAlgo] = useState("");
  const [modelName, setModelName] = useState("");
  const [algos, setAlgos] = useState<AlgoOption[]>([]);
  const [algosLoading, setAlgosLoading] = useState(true);
  const [algosError, setAlgosError] = useState<string | null>(null);
  /** Train fraction as percentage: 5–100. Default 70. */
  const [trainFractionPct, setTrainFractionPct] = useState(70);

  // Job state
  const [jobStatus, setJobStatus] = useState<JobStatus>("idle");
  const [jobError, setJobError] = useState<string | null>(null);
  const [jobResult, setJobResult] = useState<JobResult | null>(null);
  const [progressStep, setProgressStep] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [accuracyPoints, setAccuracyPoints] = useState<AccuracyPoint[]>([]);
  const [currentAccuracy, setCurrentAccuracy] = useState(0);
  // ETA computation
  const jobStartTimeRef = useRef<number | null>(null);

  // rAF batching for SSE events (realtime-ui pattern)
  const bufferRef = useRef<TrainProgressEvent[]>([]);
  const rafRef = useRef<number | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const mountedRef = useRef(true);
  // Ref wrapper so flush never holds a stale closure over onModelsTrained
  const onModelsTrainedRef = useRef(onModelsTrained);
  useEffect(() => { onModelsTrainedRef.current = onModelsTrained; }, [onModelsTrained]);
  // Same for onJobChange (reports the in-flight job to the model catalog)
  const onJobChangeRef = useRef(onJobChange);
  useEffect(() => { onJobChangeRef.current = onJobChange; }, [onJobChange]);
  // Metadata of the active job (name/slug/dataset/algo/fraction) for progress reporting
  const jobMetaRef = useRef<
    { name: string; slug: string; dataset: string; algo: string; trainFraction: number } | null
  >(null);
  // Clear any pending-card state when the Training Lab unmounts (e.g. tab switch)
  useEffect(() => {
    return () => {
      onJobChangeRef.current?.(null);
    };
  }, []);

  const [, startTransition] = useTransition();

  // ── Load algos on mount ──
  useEffect(() => {
    mountedRef.current = true;
    setAlgosLoading(true);
    fetchAlgos()
      .then((list) => {
        if (!mountedRef.current) return;
        setAlgos(list);
        if (list.length > 0) setAlgo(list[0].id);
        setAlgosError(null);
      })
      .catch((e: Error) => {
        if (!mountedRef.current) return;
        setAlgosError(`Trainer unavailable: ${e.message}`);
      })
      .finally(() => {
        if (mountedRef.current) setAlgosLoading(false);
      });

    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── rAF flush ──
  const flush = useCallback(() => {
    rafRef.current = null;
    const pending = bufferRef.current.splice(0);
    if (pending.length === 0) return;

    const latest = pending[pending.length - 1];
    const newPoints = pending.map((e) => ({ step: e.step ?? 0, accuracy: e.accuracy }));

    setAccuracyPoints((prev) => [...prev, ...newPoints]);
    setCurrentAccuracy(latest.accuracy);
    setProgressStep(latest.step ?? 0);
    setProgressTotal(latest.total ?? 0);

    if (latest.status === "done") {
      setJobStatus("done");
      setJobResult({
        accuracy: latest.accuracy,
        precision: latest.precision,
        recall: latest.recall,
        slug: latest.slug,
        name: latest.name,
        train_fraction: latest.train_fraction,
      });
      esRef.current?.close();
      esRef.current = null;

      // Refresh registry so the new model appears in the Settings popup
      startTransition(() => {
        fetchRegistry()
          .then((reg) => {
            if (mountedRef.current) setRegistry(reg);
          })
          .catch(() => {
            // Non-critical: user can still see the model after a page refresh
          });
      });
      // Notify parent (ModelCards) to refresh catalog (via ref — avoids stale closure)
      onModelsTrainedRef.current?.();
    } else if (latest.status === "error") {
      setJobStatus("error");
      setJobError(latest.error ?? "Training failed");
      esRef.current?.close();
      esRef.current = null;
    }

    // Report job progress to the model catalog (drives the live loading card)
    const meta = jobMetaRef.current;
    if (meta && onJobChangeRef.current) {
      if (latest.status === "error") {
        onJobChangeRef.current(null);
        jobMetaRef.current = null;
      } else {
        onJobChangeRef.current({
          ...meta,
          slug: latest.slug ?? meta.slug,
          status: latest.status === "done" ? "done" : "running",
          step: latest.step ?? 0,
          total: latest.total ?? 0,
          accuracy: latest.accuracy,
        });
      }
    }
  }, [setRegistry]);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(flush);
  }, [flush]);

  // ── Cleanup SSE on unmount ──
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      esRef.current?.close();
    };
  }, []);

  // ── Start training ──
  const handleTrain = useCallback(async () => {
    if (!dataset || !algo || !modelName.trim()) return;

    setJobStatus("starting");
    setJobError(null);
    setJobResult(null);
    setAccuracyPoints([]);
    setCurrentAccuracy(0);
    setProgressStep(0);
    setProgressTotal(0);
    bufferRef.current = [];
    jobStartTimeRef.current = Date.now();

    // Register the in-flight job so a live loading card shows at the top of the catalog
    const name = modelName.trim();
    jobMetaRef.current = {
      name,
      slug: slugify(name),
      dataset,
      algo,
      trainFraction: trainFractionPct / 100,
    };
    onJobChangeRef.current?.({
      ...jobMetaRef.current,
      status: "running",
      step: 0,
      total: 0,
      accuracy: 0,
    });

    let jobId: string;
    try {
      const res = await postTrain({
        dataset,
        algo,
        name,
        train_fraction: trainFractionPct / 100,
      });
      jobId = res.job_id;
    } catch (e) {
      setJobStatus("error");
      setJobError((e as Error).message);
      onJobChangeRef.current?.(null);
      jobMetaRef.current = null;
      return;
    }

    setJobStatus("running");

    // Open SSE stream
    const url = trainStreamUrl(jobId);
    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (e: MessageEvent) => {
      if (!mountedRef.current) return;
      try {
        const event: TrainProgressEvent = JSON.parse(e.data as string);
        bufferRef.current.push(event);
        scheduleFlush();
      } catch {
        // silently drop malformed events
      }
    };

    es.onerror = () => {
      if (!mountedRef.current) return;
      es.close();
      esRef.current = null;
      // Only surface error if we didn't already complete successfully
      setJobStatus((prev) => {
        if (prev !== "done") {
          setJobError("Lost connection to trainer");
          return "error";
        }
        return prev;
      });
    };
  }, [dataset, algo, modelName, trainFractionPct, scheduleFlush]);

  const handleReset = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    jobStartTimeRef.current = null;
    setJobStatus("idle");
    setJobError(null);
    setJobResult(null);
    setAccuracyPoints([]);
    setCurrentAccuracy(0);
    setProgressStep(0);
    setProgressTotal(0);
    setModelName("");
  }, []);

  const accent = registry[dataset]?.theme.accent ?? "#64748b";
  const progressPercent =
    progressTotal > 0 ? (progressStep / progressTotal) * 100 : 0;

  // ETA: elapsed / fraction_done * (1 - fraction_done)
  const etaStr = (() => {
    if (jobStatus !== "running" || progressPercent <= 0 || !jobStartTimeRef.current) return null;
    const elapsedMs = Date.now() - jobStartTimeRef.current;
    const fraction = progressPercent / 100;
    const estimatedTotalMs = elapsedMs / fraction;
    const remainingMs = estimatedTotalMs - elapsedMs;
    if (remainingMs <= 0) return null;
    const s = Math.round(remainingMs / 1000);
    if (s < 60) return `~${s}s left`;
    return `~${Math.round(s / 60)}m left`;
  })();

  const isRunning = jobStatus === "running";
  const canSubmit =
    jobStatus === "idle" &&
    dataset.trim() !== "" &&
    algo.trim() !== "" &&
    modelName.trim() !== "";

  return (
    <div className="flex flex-col gap-6">
      {/* ── Form ── */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">New training job</CardTitle>
          <p className="text-xs text-muted-foreground">
            Train a new model on a dataset and watch it learn live.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Dataset */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="train-dataset" className="text-xs font-medium text-foreground">
                Dataset
              </label>
              <select
                id="train-dataset"
                value={dataset}
                onChange={(e) => setDataset(e.target.value)}
                disabled={isRunning}
                className={cn(
                  "h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground outline-none",
                  "focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                {Object.entries(registry).map(([slug, ds]) => (
                  <option key={slug} value={slug}>
                    {ds.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Algorithm */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="train-algo" className="text-xs font-medium text-foreground">
                Algorithm
              </label>
              {algosLoading ? (
                <div className="h-8 rounded-lg border border-border bg-muted animate-pulse" />
              ) : algosError ? (
                <p className="text-xs text-destructive">{algosError}</p>
              ) : (
                <select
                  id="train-algo"
                  value={algo}
                  onChange={(e) => setAlgo(e.target.value)}
                  disabled={isRunning || algos.length === 0}
                  className={cn(
                    "h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground outline-none",
                    "focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                >
                  {algos.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Model name */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="train-name" className="text-xs font-medium text-foreground">
                Model name
              </label>
              <input
                id="train-name"
                name="model-name"
                type="text"
                placeholder="e.g. My Fraud v2…"
                autoComplete="off"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                disabled={isRunning}
                maxLength={64}
                className={cn(
                  "h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground outline-none",
                  "placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              />
            </div>
          </div>

          {/* Train fraction slider */}
          <div className="mt-4 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="train-fraction"
                className="text-xs font-medium text-foreground"
              >
                Training data fraction
              </label>
              <div className="flex items-center gap-2">
                <span
                  className="text-sm font-bold tabular-nums"
                  style={{ color: accent }}
                >
                  {trainFractionPct}%
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {fractionHint(trainFractionPct)}
                </span>
              </div>
            </div>
            <Slider
              id="train-fraction"
              min={5}
              max={100}
              step={5}
              value={[trainFractionPct]}
              onValueChange={(vals) => {
                const v = Array.isArray(vals) ? vals[0] : (vals as number);
                if (v != null) setTrainFractionPct(v);
              }}
              disabled={isRunning}
              aria-label="Training data fraction percentage"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground select-none">
              <span>5% — fastest</span>
              <span>100% — best accuracy</span>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <Button
              variant="default"
              size="sm"
              onClick={handleTrain}
              disabled={!canSubmit || algosLoading || !!algosError}
              className="gap-1.5 text-xs"
              style={{ backgroundColor: accent }}
              aria-label="Start training job"
            >
              {jobStatus === "starting" ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="size-3.5" aria-hidden="true" />
              )}
              {jobStatus === "starting" ? "Starting…" : "Train"}
            </Button>

            {(jobStatus === "done" || jobStatus === "error") && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                className="text-xs"
              >
                New job
              </Button>
            )}

            {jobStatus === "running" && (
              <p className="text-xs text-muted-foreground" aria-live="polite">
                Training step{" "}
                <span className="tabular-nums font-semibold text-foreground">
                  {progressStep}
                </span>{" "}
                /{" "}
                <span className="tabular-nums font-semibold text-foreground">
                  {progressTotal}
                </span>
              </p>
            )}

            {jobStatus === "error" && jobError && (
              <p className="flex items-center gap-1.5 text-xs text-destructive" role="alert">
                <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
                {jobError}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Live training view (shown once a job starts) ── */}
      {jobStatus !== "idle" && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
          {/* Accuracy curve */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">
                  Live accuracy curve
                </CardTitle>
                {jobStatus === "running" && (
                  <span
                    className="text-xl font-bold tabular-nums"
                    style={{ color: accent }}
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    {(currentAccuracy * 100).toFixed(1)}%
                  </span>
                )}
                {jobStatus === "done" && jobResult && (
                  <div className="flex items-center gap-1.5 text-green-600">
                    <CheckCircle2 className="size-4" aria-hidden="true" />
                    <span className="text-xs font-semibold">Done</span>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {/* Polished segmented progress bar */}
              {(jobStatus === "running" || jobStatus === "done") && (
                <div className="mb-3 flex flex-col gap-1.5">
                  <SegmentedProgress
                    percent={jobStatus === "done" ? 100 : progressPercent}
                    accent={accent}
                    reducedMotion={reducedMotion}
                  />
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
                    <span>
                      Step{" "}
                      <span className="font-semibold text-foreground">
                        {progressStep}
                      </span>{" "}
                      /{" "}
                      <span className="font-semibold text-foreground">
                        {progressTotal}
                      </span>
                    </span>
                    <div className="flex items-center gap-2">
                      {etaStr && (
                        <span className="flex items-center gap-1">
                          <Zap className="size-2.5" aria-hidden="true" />
                          {etaStr}
                        </span>
                      )}
                      <span>
                        {progressTotal > 0
                          ? `${Math.round(progressPercent)}%`
                          : "—"}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <LiveCurve points={accuracyPoints} accent={accent} />
            </CardContent>
          </Card>

          {/* Final metrics / status */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                {jobStatus === "done" ? "Final metrics" : "Status"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {jobStatus === "running" && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2
                      className="size-3.5 animate-spin shrink-0"
                      style={{ color: accent }}
                      aria-hidden="true"
                    />
                    Training in progress…
                  </div>
                  <div className="flex flex-col gap-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Current accuracy</span>
                      <span
                        className="font-semibold tabular-nums"
                        style={{ color: accent }}
                        aria-live="polite"
                      >
                        {(currentAccuracy * 100).toFixed(2)}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Steps done</span>
                      <span className="font-semibold tabular-nums">
                        {progressStep} / {progressTotal}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {jobStatus === "done" && jobResult && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-xs text-green-600 font-medium">
                    <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
                    Model trained successfully
                  </div>
                  <div className="flex flex-col gap-2 text-xs">
                    {jobResult.name && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Name</span>
                        <span className="font-semibold truncate max-w-[120px]">{jobResult.name}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Accuracy</span>
                      <span className="font-semibold tabular-nums" style={{ color: accent }}>
                        {(jobResult.accuracy * 100).toFixed(2)}%
                      </span>
                    </div>
                    {jobResult.precision != null && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Precision</span>
                        <span className="font-semibold tabular-nums">
                          {(jobResult.precision * 100).toFixed(2)}%
                        </span>
                      </div>
                    )}
                    {jobResult.recall != null && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Recall</span>
                        <span className="font-semibold tabular-nums">
                          {(jobResult.recall * 100).toFixed(2)}%
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Data used</span>
                      <span className="font-semibold tabular-nums">
                        {jobResult.train_fraction != null
                          ? `${Math.round(jobResult.train_fraction * 100)}%`
                          : `${trainFractionPct}%`}
                      </span>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Model is now available in Settings to activate or export.
                  </p>
                </div>
              )}

              {jobStatus === "error" && (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="flex items-center gap-1.5 text-destructive font-medium">
                    <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
                    Training failed
                  </div>
                  {jobError && (
                    <p className="text-muted-foreground">{jobError}</p>
                  )}
                </div>
              )}

              {jobStatus === "starting" && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin shrink-0" aria-hidden="true" />
                  Starting job…
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
