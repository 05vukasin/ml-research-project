"use client";

/**
 * SettingsPopup — T26 + T27
 *
 * Gear button in the header that opens a shadcn Dialog.
 * Sections:
 *  1. Dataset + model selection — reads useDashboard().registry
 *  2. Speed slider (interval_ms 50–2000ms) + Pause/Resume toggle → POST /control
 *  3. Model export buttons (joblib/pickle/onnx/pmml) → modelExportUrl, disabled if null
 *
 * On Apply → switchDataset(dataset, model) then close.
 * Export triggers a real anchor download without opening the dialog.
 */
import { useState, useCallback, useTransition } from "react";
import { Settings2, Download, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useDashboard } from "@/context/DashboardContext";
import { postControl, modelExportUrl } from "@/lib/api";
import type { RegistryModel } from "@/lib/types";

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

// ── Speed labels ──────────────────────────────────────────────────
function msToLabel(ms: number): string {
  if (ms <= 100) return "Fast";
  if (ms <= 500) return "Normal";
  if (ms <= 1000) return "Slow";
  return "Very slow";
}

interface ExportButtonsProps {
  dataset: string;
  model: RegistryModel;
}

function ExportButtons({ dataset, model }: ExportButtonsProps) {
  const accent = useDashboard().datasetMeta?.theme.accent ?? "#64748b";

  const triggerDownload = useCallback(
    (format: string) => {
      const url = modelExportUrl(dataset, model.slug, format);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${model.slug}.${FORMAT_LABELS[format] ?? format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    },
    [dataset, model.slug]
  );

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-foreground">Export model</p>
      <div className="flex flex-wrap gap-2">
        {(["joblib", "pickle", "onnx", "pmml"] as const).map((fmt) => {
          const available =
            model.formats[fmt as keyof typeof model.formats] != null;
          const label = FORMAT_LABELS[fmt] ?? fmt;
          const description = FORMAT_DESCRIPTIONS[fmt];

          const btn = (
            <Button
              key={fmt}
              variant="outline"
              size="sm"
              disabled={!available}
              onClick={available ? () => triggerDownload(fmt) : undefined}
              aria-label={`Download ${label} format`}
              className={cn(
                "gap-1.5 text-xs",
                available && "hover:shadow-sm"
              )}
              style={
                available
                  ? { borderColor: `${accent}40`, color: accent }
                  : {}
              }
            >
              <Download className="size-3" aria-hidden="true" />
              {label}
            </Button>
          );

          // Disabled formats get a tooltip explaining why
          if (!available) {
            return (
              <Tooltip key={fmt}>
                <TooltipTrigger
                  render={
                    // wrap in span so Tooltip can attach to a non-disabled element
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

// ── Main popup ────────────────────────────────────────────────────

export function SettingsPopup() {
  const { registry, activeDataset, activeModel, modelMeta, switchDataset, paused, setPaused } =
    useDashboard();

  const [open, setOpen] = useState(false);

  // Local selections (committed on Apply)
  const [selectedDataset, setSelectedDataset] = useState(activeDataset);
  const [selectedModel, setSelectedModel] = useState(activeModel);

  // Speed local state (applied immediately on change for responsive feel)
  const [intervalMs, setIntervalMs] = useState(500);

  const [isPending, startTransition] = useTransition();

  // Sync local selections whenever popup opens
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        setSelectedDataset(activeDataset);
        setSelectedModel(activeModel);
      }
      setOpen(next);
    },
    [activeDataset, activeModel]
  );

  // When dataset selection changes, default to first model of that dataset
  const handleDatasetChange = useCallback(
    (ds: string) => {
      setSelectedDataset(ds);
      const firstModel = registry[ds]?.models[0]?.slug ?? "";
      setSelectedModel(firstModel);
    },
    [registry]
  );

  const handleApply = useCallback(() => {
    startTransition(async () => {
      await switchDataset(selectedDataset, selectedModel);
      setOpen(false);
    });
  }, [selectedDataset, selectedModel, switchDataset]);

  const handleSpeedChange = useCallback(
    async (values: number | readonly number[]) => {
      const ms = Array.isArray(values) ? (values[0] ?? 500) : (values as number);
      setIntervalMs(ms);
      try {
        await postControl({ interval_ms: ms });
      } catch {
        // Non-critical: stream continues, just at old speed
      }
    },
    []
  );

  const handlePauseToggle = useCallback(async () => {
    await setPaused(!paused);
  }, [paused, setPaused]);

  const selectedDatasetMeta = registry[selectedDataset];
  const selectedModelMeta =
    selectedDatasetMeta?.models.find((m) => m.slug === selectedModel) ??
    selectedDatasetMeta?.models[0] ??
    null;
  const accent = selectedDatasetMeta?.theme.accent ?? "#64748b";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open settings"
            title="Settings"
          >
            <Settings2 className="size-4 text-muted-foreground" aria-hidden="true" />
          </Button>
        }
      />

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span
              className="size-5 rounded-md inline-flex items-center justify-center text-white text-[10px] font-bold shrink-0"
              style={{ backgroundColor: accent }}
              aria-hidden="true"
            >
              ML
            </span>
            Dashboard settings
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-6 py-1">
          {/* ── Dataset selection ── */}
          <section aria-labelledby="section-dataset">
            <p id="section-dataset" className="text-xs font-medium text-foreground mb-2">
              Dataset
            </p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="section-dataset">
              {Object.entries(registry).map(([slug, ds]) => {
                const isSelected = selectedDataset === slug;
                return (
                  <button
                    key={slug}
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => handleDatasetChange(slug)}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-xs font-medium transition-all outline-none",
                      "focus-visible:ring-2 focus-visible:ring-ring/50",
                      isSelected
                        ? "border-current text-white shadow-sm"
                        : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                    style={isSelected ? { backgroundColor: ds.theme.accent, borderColor: ds.theme.accent } : {}}
                  >
                    {ds.label}
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── Model selection ── */}
          {selectedDatasetMeta && (
            <section aria-labelledby="section-model">
              <p id="section-model" className="text-xs font-medium text-foreground mb-2">
                Model
              </p>
              <div className="flex flex-col gap-2" role="radiogroup" aria-labelledby="section-model">
                {selectedDatasetMeta.models.map((m) => {
                  const isSelected = selectedModel === m.slug;
                  return (
                    <button
                      key={m.slug}
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => setSelectedModel(m.slug)}
                      className={cn(
                        "flex items-start gap-3 rounded-lg border p-3 text-left transition-all outline-none",
                        "focus-visible:ring-2 focus-visible:ring-ring/50",
                        isSelected
                          ? "border-current bg-muted/40"
                          : "border-border bg-background hover:bg-muted/30"
                      )}
                      style={isSelected ? { borderColor: accent } : {}}
                    >
                      {/* Selection indicator */}
                      <span
                        className={cn(
                          "mt-0.5 size-3.5 rounded-full border-2 shrink-0 transition-colors",
                          isSelected ? "border-current" : "border-border"
                        )}
                        style={isSelected ? { borderColor: accent, backgroundColor: `${accent}30` } : {}}
                        aria-hidden="true"
                      />
                      <div className="flex flex-col gap-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-foreground truncate">
                            {m.name}
                          </span>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                            {m.algo.replace("Classifier", "")}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-muted-foreground tabular-nums">
                          <span>Acc <span className="font-semibold text-foreground">{(m.metrics.accuracy * 100).toFixed(1)}%</span></span>
                          <span>Prec <span className="font-semibold text-foreground">{(m.metrics.precision * 100).toFixed(1)}%</span></span>
                          <span>Rec <span className="font-semibold text-foreground">{(m.metrics.recall * 100).toFixed(1)}%</span></span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── Stream speed ── */}
          <section aria-labelledby="section-speed">
            <div className="flex items-center justify-between mb-2">
              <p id="section-speed" className="text-xs font-medium text-foreground">
                Stream speed
              </p>
              <span className="text-xs text-muted-foreground tabular-nums">
                {intervalMs}ms · {msToLabel(intervalMs)}
              </span>
            </div>
            <Slider
              min={50}
              max={2000}
              step={50}
              value={[intervalMs]}
              onValueChange={handleSpeedChange}
              aria-label="Stream interval in milliseconds"
            />
            <div className="flex justify-between mt-1 text-[10px] text-muted-foreground select-none">
              <span>50ms (fast)</span>
              <span>2000ms (slow)</span>
            </div>
          </section>

          {/* ── Pause / Resume ── */}
          <section>
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-foreground">Stream</p>
              <Button
                variant={paused ? "default" : "outline"}
                size="sm"
                onClick={handlePauseToggle}
                aria-pressed={paused}
                className="gap-1.5 text-xs"
                style={!paused ? { borderColor: `${accent}40` } : {}}
              >
                {paused ? "Resume stream" : "Pause stream"}
              </Button>
            </div>
            {paused && (
              <p role="status" className="mt-1.5 text-[10px] text-amber-600 font-medium">
                Stream is paused — no new predictions are flowing.
              </p>
            )}
          </section>

          {/* ── Export ── */}
          {selectedModelMeta && (
            <ExportButtons dataset={selectedDataset} model={selectedModelMeta} />
          )}
        </div>

        <DialogFooter>
          <Button
            variant="default"
            size="sm"
            onClick={handleApply}
            disabled={isPending}
            className="gap-1.5"
            style={{ backgroundColor: accent }}
            aria-label="Apply dataset and model selection"
          >
            {isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : null}
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
