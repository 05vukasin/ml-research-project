"use client";

/**
 * BenchmarkSurface — T52
 *
 * Compact panel on the Dashboard tab for the ACTIVE model:
 *  - Current run: live stats from fetchCurrentRun (polled every 2s while active)
 *  - Last run: saved stats from fetchLastRun (fetched once on mount / model change)
 *  - A subtle "recording…" pulse while a current run is in progress
 *  - Stays visually subordinate to the hero gauge
 *
 * Updates automatically when the active model changes (via useDashboard).
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Dot, TrendingUp, Clock, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboard } from "@/context/DashboardContext";
import { fetchCurrentRun, fetchLastRun } from "@/lib/api";
import type { CurrentRun, ModelRun } from "@/lib/types";
import { cn } from "@/lib/utils";

const CURRENT_RUN_POLL_MS = 2_000;

// ── Sub-components ─────────────────────────────────────────────────

interface StatCellProps {
  label: string;
  value: string;
  highlight?: boolean;
  accentColor?: string;
  muted?: boolean;
}

function StatCell({ label, value, highlight, accentColor, muted }: StatCellProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className={cn(
          "text-base font-bold tabular-nums leading-tight",
          muted && "text-muted-foreground"
        )}
        style={highlight && accentColor ? { color: accentColor } : {}}
      >
        {value}
      </span>
      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────

export function BenchmarkSurface() {
  const { activeDataset, activeModel, datasetMeta, modelMeta } = useDashboard();
  const reducedMotion = useReducedMotion() ?? false;
  const accent = datasetMeta?.theme.accent ?? "#64748b";

  const [currentRun, setCurrentRun] = useState<CurrentRun | null>(null);
  const [lastRun, setLastRun] = useState<ModelRun | null | undefined>(undefined);
  const [loadingLast, setLoadingLast] = useState(true);

  const mountedRef = useRef(true);
  const currentPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch last run when model changes; also resets currentRun to avoid stale stats ──
  useEffect(() => {
    // Reset current-run immediately on model change so stale stats never show
    setCurrentRun(null);

    if (!activeDataset || !activeModel) return;
    setLoadingLast(true);
    setLastRun(undefined);

    fetchLastRun(activeDataset, activeModel)
      .then((r) => {
        if (mountedRef.current) {
          setLastRun(r.run);
          setLoadingLast(false);
        }
      })
      .catch(() => {
        if (mountedRef.current) {
          setLastRun(null);
          setLoadingLast(false);
        }
      });
  }, [activeDataset, activeModel]);

  // ── Poll current run every 2s ──
  const pollCurrentRun = useCallback(async () => {
    if (!activeDataset || !activeModel) return;
    try {
      const resp = await fetchCurrentRun(activeDataset, activeModel);
      if (mountedRef.current) setCurrentRun(resp.current_run);
    } catch {
      // Silently ignore — the panel degrades gracefully
    }
  }, [activeDataset, activeModel]);

  useEffect(() => {
    mountedRef.current = true;
    // Poll immediately then on interval
    pollCurrentRun();
    currentPollRef.current = setInterval(pollCurrentRun, CURRENT_RUN_POLL_MS);
    return () => {
      if (currentPollRef.current) clearInterval(currentPollRef.current);
    };
  }, [pollCurrentRun]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Don't render if no active model
  if (!activeDataset || !activeModel) return null;

  const hasCurrentRun = currentRun !== null;
  const hasLastRun = lastRun !== null && lastRun !== undefined;

  // Format elapsed time
  const elapsedStr = currentRun
    ? currentRun.elapsed_s >= 3600
      ? `${Math.floor(currentRun.elapsed_s / 3600)}h ${Math.floor((currentRun.elapsed_s % 3600) / 60)}m`
      : currentRun.elapsed_s >= 60
      ? `${Math.floor(currentRun.elapsed_s / 60)}m ${Math.round(currentRun.elapsed_s % 60)}s`
      : `${Math.round(currentRun.elapsed_s)}s`
    : null;

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">
            Model benchmark
          </CardTitle>

          {/* Recording indicator */}
          {hasCurrentRun && (
            <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
              <motion.div
                animate={reducedMotion ? {} : { opacity: [1, 0.3, 1] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
              >
                <Dot
                  className="size-5 -mx-1.5"
                  style={{ color: accent }}
                  aria-hidden="true"
                />
              </motion.div>
              recording
              {elapsedStr && (
                <span className="tabular-nums ml-0.5">· {elapsedStr}</span>
              )}
            </div>
          )}
        </div>
        {/* Active model label */}
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span
            className="size-2 rounded-full shrink-0"
            style={{ backgroundColor: accent }}
            aria-hidden="true"
          />
          {modelMeta?.name ?? activeModel}
          <span className="opacity-50">·</span>
          <span>{datasetMeta?.label ?? activeDataset}</span>
        </div>
      </CardHeader>

      <CardContent>
        <div className="flex flex-col gap-4">
          {/* Current run block */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="size-3 text-muted-foreground" aria-hidden="true" />
              <span className="text-[11px] font-medium text-foreground">Current run</span>
            </div>

            {!hasCurrentRun ? (
              <p className="text-xs text-muted-foreground italic pl-4">
                No active run — activate this model to start recording.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-4 pl-4">
                <StatCell
                  label="Accuracy"
                  value={`${(currentRun.accuracy * 100).toFixed(1)}%`}
                  highlight
                  accentColor={accent}
                />
                <StatCell
                  label="Throughput"
                  value={`${currentRun.throughput_per_sec.toFixed(1)}/s`}
                />
                <StatCell
                  label="Avg latency"
                  value={`${currentRun.avg_latency_ms.toFixed(0)} ms`}
                />
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="border-t border-border" />

          {/* Last run block */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <Clock className="size-3 text-muted-foreground" aria-hidden="true" />
              <span className="text-[11px] font-medium text-foreground">Last saved run</span>
            </div>

            {loadingLast || lastRun === undefined ? (
              <div className="grid grid-cols-3 gap-4 pl-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex flex-col gap-1">
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-2.5 w-16" />
                  </div>
                ))}
              </div>
            ) : !hasLastRun ? (
              <p className="text-xs text-muted-foreground italic pl-4">
                No completed run recorded yet.
              </p>
            ) : (
              <div className="flex flex-col gap-2 pl-4">
                <div className="grid grid-cols-3 gap-4">
                  <StatCell
                    label="Accuracy"
                    value={`${(lastRun.accuracy * 100).toFixed(1)}%`}
                    muted={hasCurrentRun}
                  />
                  <StatCell
                    label="Throughput"
                    value={`${lastRun.throughput_per_sec.toFixed(1)}/s`}
                    muted={hasCurrentRun}
                  />
                  <StatCell
                    label="Avg latency"
                    value={`${lastRun.avg_latency_ms.toFixed(0)} ms`}
                    muted={hasCurrentRun}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {lastRun.total.toLocaleString()} events processed
                </span>

                {/* Delta hint when both runs are present */}
                {hasCurrentRun && (
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Zap className="size-2.5" aria-hidden="true" />
                    <span>
                      {currentRun.accuracy >= lastRun.accuracy ? (
                        <span className="text-green-600 font-medium">
                          +{((currentRun.accuracy - lastRun.accuracy) * 100).toFixed(1)}% vs last run
                        </span>
                      ) : (
                        <span className="text-amber-600 font-medium">
                          {((currentRun.accuracy - lastRun.accuracy) * 100).toFixed(1)}% vs last run
                        </span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
