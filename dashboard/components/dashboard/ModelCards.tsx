"use client";

/**
 * ModelCards — T51
 *
 * Responsive grid of model cards, one per model from GET /models.
 * Card face: name, dataset badge, algo, accuracy, train_fraction, source.
 * Click → expand (Motion layout/height) to reveal:
 *   - Full metrics (accuracy, precision, recall)
 *   - Last-run benchmark (via fetchLastRun) — reuses KpiCards / confusion pattern
 *   - Per-format export buttons (reuses ExportButtons pattern from SettingsPopup)
 *   - "Use" button → switchDataset
 * Only one card expanded at a time.
 * Refreshes on mount + when onRefresh() is called (after training completes).
 */
import {
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  ChevronDown,
  Download,
  Play,
  RefreshCw,
  Database,
  Cpu,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useDashboard } from "@/context/DashboardContext";
import { fetchModels, fetchLastRun, modelExportUrl } from "@/lib/api";
import type { ModelCatalogEntry, ModelRun, PendingTrainingJob } from "@/lib/types";
import { cn } from "@/lib/utils";

// ── Helpers ────────────────────────────────────────────────────────

const FORMAT_LABELS: Record<string, string> = {
  joblib: "joblib",
  pickle: "pkl",
  onnx: "ONNX",
  pmml: "PMML",
};

const FORMAT_DESCRIPTIONS: Record<string, string> = {
  joblib: "Native scikit-learn format",
  pickle: "Python pickle serialisation",
  onnx: "Open Neural Network Exchange",
  pmml: "PMML not available — requires Java at train time",
};

function formatDateShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

// ── ConfusionMini ──────────────────────────────────────────────────

interface ConfusionMiniProps {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  accentColor: string;
}

function ConfusionMini({ tp, fp, fn, tn, accentColor }: ConfusionMiniProps) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {[
        { label: "TP", value: tp, highlight: true },
        { label: "FP", value: fp, highlight: false },
        { label: "FN", value: fn, highlight: false },
        { label: "TN", value: tn, highlight: false },
      ].map(({ label, value, highlight }) => (
        <div
          key={label}
          className="flex flex-col items-center justify-center rounded-lg border border-border p-2 gap-0.5"
          style={
            highlight
              ? { borderColor: accentColor, backgroundColor: `${accentColor}10` }
              : {}
          }
        >
          <span
            className="text-sm font-bold tabular-nums"
            style={highlight ? { color: accentColor } : {}}
          >
            {value.toLocaleString()}
          </span>
          <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── ExportRow ──────────────────────────────────────────────────────

interface ExportRowProps {
  dataset: string;
  slug: string;
  formats: ModelCatalogEntry["formats"];
  accentColor: string;
}

function ExportRow({ dataset, slug, formats, accentColor }: ExportRowProps) {
  const triggerDownload = useCallback(
    (format: string) => {
      const url = modelExportUrl(dataset, slug, format);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slug}.${FORMAT_LABELS[format] ?? format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    },
    [dataset, slug]
  );

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-foreground">Export</p>
      <div className="flex flex-wrap gap-1.5">
        {(["joblib", "pickle", "onnx", "pmml"] as const).map((fmt) => {
          const available = formats[fmt] != null;
          const label = FORMAT_LABELS[fmt] ?? fmt;
          const description = FORMAT_DESCRIPTIONS[fmt];

          const btn = (
            <Button
              key={fmt}
              variant="outline"
              size="sm"
              disabled={!available}
              onClick={available ? () => triggerDownload(fmt) : undefined}
              aria-label={`Download ${label}`}
              className={cn("gap-1 text-xs h-7 px-2", available && "hover:shadow-sm")}
              style={
                available
                  ? { borderColor: `${accentColor}40`, color: accentColor }
                  : {}
              }
            >
              <Download className="size-3" aria-hidden="true" />
              {label}
            </Button>
          );

          if (!available) {
            return (
              <Tooltip key={fmt}>
                <TooltipTrigger
                  render={
                    <span tabIndex={0} aria-label={description} className="inline-block">
                      {btn}
                    </span>
                  }
                />
                <TooltipContent side="top">{description}</TooltipContent>
              </Tooltip>
            );
          }

          return (
            <Tooltip key={fmt}>
              <TooltipTrigger render={btn} />
              <TooltipContent side="top">{description}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

// ── LastRunPanel ───────────────────────────────────────────────────

interface LastRunPanelProps {
  dataset: string;
  slug: string;
  accentColor: string;
}

function LastRunPanel({ dataset, slug, accentColor }: LastRunPanelProps) {
  const [run, setRun] = useState<ModelRun | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetchLastRun(dataset, slug)
      .then((r) => {
        if (!cancelled) setRun(r.run);
      })
      .catch(() => {
        if (!cancelled) setRun(null);
      });
    return () => {
      cancelled = true;
    };
  }, [dataset, slug]);

  if (run === undefined) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-24" />
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (run === null) {
    return (
      <p className="text-xs text-muted-foreground italic">
        No benchmark run recorded yet. Activate this model to start one.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium text-foreground">
        Last benchmark run
        <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">
          ({run.total.toLocaleString()} events · {formatDateShort(run.started_at)})
        </span>
      </p>
      {/* Mini KPI row */}
      <div className="grid grid-cols-3 gap-2">
        {[
          {
            label: "Accuracy",
            value: `${(run.accuracy * 100).toFixed(1)}%`,
            highlight: true,
          },
          {
            label: "Throughput",
            value: `${run.throughput_per_sec.toFixed(1)}/s`,
          },
          { label: "Avg latency", value: `${run.avg_latency_ms.toFixed(0)} ms` },
        ].map(({ label, value, highlight }) => (
          <div
            key={label}
            className="flex flex-col items-center justify-center rounded-lg border border-border p-2 gap-0.5"
            style={
              highlight
                ? { borderColor: accentColor, backgroundColor: `${accentColor}08` }
                : {}
            }
          >
            <span
              className="text-sm font-bold tabular-nums"
              style={highlight ? { color: accentColor } : {}}
            >
              {value}
            </span>
            <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">
              {label}
            </span>
          </div>
        ))}
      </div>
      {/* Confusion mini */}
      {run.confusion && (
        <ConfusionMini
          tp={run.confusion.tp}
          fp={run.confusion.fp}
          fn={run.confusion.fn}
          tn={run.confusion.tn}
          accentColor={accentColor}
        />
      )}
    </div>
  );
}

// ── ModelCard ──────────────────────────────────────────────────────

interface ModelCardProps {
  model: ModelCatalogEntry;
  isExpanded: boolean;
  onToggle: () => void;
  onUse: (dataset: string, slug: string) => void;
  isActive: boolean;
}

function ModelCard({ model, isExpanded, onToggle, onUse, isActive }: ModelCardProps) {
  const { registry } = useDashboard();
  const reducedMotion = useReducedMotion() ?? false;
  const datasetMeta = registry[model.dataset];
  const accentColor = datasetMeta?.theme.accent ?? "#64748b";

  const fractionLabel =
    model.train_fraction != null
      ? `${Math.round(model.train_fraction * 100)}% data`
      : "seeded";

  const algoShort = model.algo.replace("Classifier", "").trim();

  return (
    <Card
      className={cn(
        "shadow-sm transition-shadow duration-200",
        isExpanded && "shadow-md",
        "focus-within:ring-2 focus-within:ring-ring/40"
      )}
      style={isExpanded ? { borderColor: `${accentColor}50` } : {}}
    >
      {/* ── Card face — wrapped in a real <button> for correct semantics ── */}
      <CardHeader className="pb-3 p-0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          aria-label={`${model.name} — ${isExpanded ? "collapse" : "expand"} details`}
          className="w-full text-left px-6 pt-6 pb-3 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-xl"
        >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5 min-w-0">
            {/* Name row */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-foreground truncate">
                {model.name}
              </span>
              {isActive && (
                <Badge
                  className="text-[9px] px-1.5 py-0 h-4 border-0 text-white shrink-0"
                  style={{ backgroundColor: accentColor }}
                >
                  active
                </Badge>
              )}
            </div>

            {/* Meta row */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Dataset badge */}
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                style={{ backgroundColor: accentColor }}
              >
                <Database className="size-2.5" aria-hidden="true" />
                {datasetMeta?.label ?? model.dataset}
              </span>
              {/* Algo badge */}
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                <Cpu className="size-2.5" aria-hidden="true" />
                {algoShort}
              </span>
              {/* Source tag */}
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  model.source === "seeded"
                    ? "bg-slate-100 text-slate-500"
                    : "bg-green-50 text-green-700"
                )}
              >
                {model.source}
              </span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1.5 shrink-0">
            {/* Accuracy */}
            <span
              className="text-xl font-bold tabular-nums leading-none"
              style={{ color: accentColor }}
            >
              {(model.accuracy * 100).toFixed(1)}%
            </span>
            <span className="text-[10px] text-muted-foreground">accuracy</span>
            {/* Fraction */}
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {fractionLabel}
            </span>
          </div>
        </div>

        {/* Expand chevron */}
        <div className="flex justify-center mt-1">
          <motion.div
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={reducedMotion ? { duration: 0 } : { duration: 0.2 }}
          >
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
          </motion.div>
        </div>
        </button>
      </CardHeader>

      {/* ── Expanded body ── */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            key="expanded"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={
              reducedMotion
                ? { duration: 0 }
                : { duration: 0.25, ease: "easeOut" }
            }
            style={{ overflow: "hidden" }}
          >
            <CardContent className="pt-0 pb-4">
              <div className="border-t border-border pt-4 flex flex-col gap-5">

                {/* Metrics + last-run side by side on wide cards */}
                <div className="grid gap-5 md:grid-cols-2">
                  {/* Full metrics */}
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-medium text-foreground">Model metrics</p>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: "Accuracy", value: `${(model.accuracy * 100).toFixed(1)}%`, highlight: true },
                        { label: "Precision", value: `${(model.precision * 100).toFixed(1)}%` },
                        { label: "Recall", value: `${(model.recall * 100).toFixed(1)}%` },
                      ].map(({ label, value, highlight }) => (
                        <div
                          key={label}
                          className="flex flex-col items-center justify-center rounded-lg border border-border p-2 gap-0.5"
                          style={
                            highlight
                              ? { borderColor: accentColor, backgroundColor: `${accentColor}08` }
                              : {}
                          }
                        >
                          <span
                            className="text-sm font-bold tabular-nums"
                            style={highlight ? { color: accentColor } : {}}
                          >
                            {value}
                          </span>
                          <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">
                            {label}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-4 text-[10px] text-muted-foreground">
                      <span>Trained {formatDateShort(model.trained_at)}</span>
                      <span>
                        Data fraction:{" "}
                        <span className="font-semibold text-foreground tabular-nums">
                          {model.train_fraction != null
                            ? `${Math.round(model.train_fraction * 100)}%`
                            : "full (seeded)"}
                        </span>
                      </span>
                    </div>
                  </div>

                  {/* Last-run benchmark */}
                  <LastRunPanel
                    dataset={model.dataset}
                    slug={model.slug}
                    accentColor={accentColor}
                  />
                </div>

                {/* Export + Use row */}
                <div className="flex flex-wrap items-end justify-between gap-4 border-t border-border pt-4">
                  <ExportRow
                    dataset={model.dataset}
                    slug={model.slug}
                    formats={model.formats}
                    accentColor={accentColor}
                  />

                  <Button
                    variant={isActive ? "outline" : "default"}
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onUse(model.dataset, model.slug);
                    }}
                    className="gap-1.5 text-xs shrink-0"
                    style={
                      !isActive
                        ? { backgroundColor: accentColor }
                        : { borderColor: `${accentColor}50`, color: accentColor }
                    }
                    aria-label={`Use ${model.name}`}
                  >
                    <Play className="size-3" aria-hidden="true" />
                    {isActive ? "Currently active" : "Use this model"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

// ── PendingModelCard (live training) ───────────────────────────────

function PendingModelCard({ job }: { job: PendingTrainingJob }) {
  const { registry } = useDashboard();
  const reducedMotion = useReducedMotion() ?? false;
  const accentColor = registry[job.dataset]?.theme.accent ?? "#64748b";
  const datasetLabel = registry[job.dataset]?.label ?? job.dataset;
  const algoShort = job.algo.replace(/Classifier|_/g, " ").trim() || job.algo;

  const pct = job.total > 0 ? Math.min(100, (job.step / job.total) * 100) : 0;
  const finalizing = job.status === "done";

  return (
    <Card
      className="overflow-hidden shadow-sm"
      style={{ borderColor: `${accentColor}55` }}
    >
      {/* Accent progress strip along the very top */}
      <div className="h-1 w-full bg-slate-100 origin-left">
        <motion.div
          className="h-full"
          style={{ backgroundColor: accentColor, transformOrigin: "left" }}
          initial={false}
          animate={{ scaleX: job.total > 0 ? pct / 100 : 0.9 }}
          transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 80, damping: 20 }}
        />
      </div>

      <CardContent className="px-6 py-4">
        <div className="flex items-center gap-4">
          {/* Spinner */}
          <div className="shrink-0">
            <Loader2
              className={cn("size-5", !reducedMotion && "animate-spin")}
              style={{ color: accentColor }}
              aria-hidden="true"
            />
          </div>

          {/* Name + meta */}
          <div className="flex flex-col gap-1.5 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-foreground truncate">
                {job.name || "New model"}
              </span>
              <motion.span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                style={{ backgroundColor: accentColor }}
                animate={reducedMotion ? {} : { opacity: [1, 0.55, 1] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
              >
                {finalizing ? "finalizing" : "training"}
              </motion.span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                style={{ backgroundColor: accentColor }}
              >
                <Database className="size-2.5" aria-hidden="true" />
                {datasetLabel}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                <Cpu className="size-2.5" aria-hidden="true" />
                {algoShort}
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 tabular-nums">
                {Math.round(job.trainFraction * 100)}% data
              </span>
            </div>
          </div>

          {/* Live accuracy + step */}
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span
              className="text-xl font-bold tabular-nums leading-none"
              style={{ color: accentColor }}
            >
              {(job.accuracy * 100).toFixed(1)}%
            </span>
            <span className="text-[10px] text-muted-foreground">accuracy</span>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {finalizing
                ? "saving…"
                : job.total > 0
                  ? `step ${job.step} / ${job.total}`
                  : "starting…"}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── ModelCards (grid) ──────────────────────────────────────────────

interface ModelCardsProps {
  /** External refresh trigger — bump to force a re-fetch */
  refreshKey?: number;
  /** In-flight training job → shown as a live loading card at the top */
  pendingJob?: PendingTrainingJob | null;
}

export function ModelCards({ refreshKey = 0, pendingJob = null }: ModelCardsProps) {
  const { activeDataset, activeModel, switchDataset } = useDashboard();
  const [models, setModels] = useState<ModelCatalogEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const data = await fetchModels();
      if (mountedRef.current) {
        setModels(data);
        setError(null);
      }
    } catch (e) {
      if (mountedRef.current) setError((e as Error).message);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // Initial load + refresh when key bumps
  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
    };
    // `load` is stable (useCallback with [] deps); intentionally omitted so only
    // refreshKey bumps trigger a catalog reload, not internal load identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-doctor/exhaustive-deps
  }, [refreshKey]);

  const handleToggle = useCallback((slug: string) => {
    setExpandedSlug((prev) => (prev === slug ? null : slug));
  }, []);

  const handleUse = useCallback(
    async (dataset: string, slug: string) => {
      await switchDataset(dataset, slug);
    },
    [switchDataset]
  );

  // Show the live training card unless that model already exists in the catalog.
  const pendingInList =
    pendingJob != null &&
    (models ?? []).some(
      (m) => m.dataset === pendingJob.dataset && m.slug === pendingJob.slug
    );
  const showPending = pendingJob != null && !pendingInList;

  // Newest first — freshly trained models (newest created_at) bubble to the top.
  const sorted = [...(models ?? [])].sort((a, b) => {
    const ta = new Date(a.created_at || a.trained_at).getTime();
    const tb = new Date(b.created_at || b.trained_at).getTime();
    return tb - ta || b.id - a.id;
  });

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        Could not load models: {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Model catalog</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {loading
              ? "Loading models…"
              : `${sorted.length} model${sorted.length !== 1 ? "s" : ""} — newest first; click a card to expand metrics, benchmarks, and exports`}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => load(true)}
          disabled={refreshing || loading}
          className="gap-1.5 text-xs text-muted-foreground"
          aria-label="Refresh model catalog"
        >
          <RefreshCw className={cn("size-3", refreshing && "animate-spin")} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {/* Full-width stacked list */}
      <div className="flex flex-col gap-3">
        {/* Live training card pinned to the top */}
        <AnimatePresence initial={false}>
          {showPending && pendingJob && (
            <motion.div
              key="pending"
              layout
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              <PendingModelCard job={pendingJob} />
            </motion.div>
          )}
        </AnimatePresence>

        {loading &&
          [1, 2, 3].map((i) => (
            <Card key={i} className="shadow-sm">
              <CardContent className="p-6 flex items-center justify-between">
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <Skeleton className="h-7 w-14" />
              </CardContent>
            </Card>
          ))}

        {!loading && sorted.length === 0 && !showPending && (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No models found.
          </div>
        )}

        {!loading &&
          sorted.map((model) => (
            <ModelCard
              key={`${model.dataset}/${model.slug}`}
              model={model}
              isExpanded={expandedSlug === `${model.dataset}/${model.slug}`}
              onToggle={() => handleToggle(`${model.dataset}/${model.slug}`)}
              onUse={handleUse}
              isActive={activeDataset === model.dataset && activeModel === model.slug}
            />
          ))}
      </div>
    </div>
  );
}
