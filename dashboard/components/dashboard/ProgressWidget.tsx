"use client";

/**
 * ProgressWidget — T28
 *
 * A small side widget showing the percentage of dataset rows processed.
 * Polls GET /progress?dataset=<active> every 2s.
 * Visually secondary to the hero gauge — compact card, linear progress bar,
 * not a competing radial arc.
 *
 * Spring-animates the bar width (transform) for a smooth feel.
 * Respects prefers-reduced-motion.
 */
import { useEffect, useState, useCallback, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { useDashboard } from "@/context/DashboardContext";
import { fetchProgress } from "@/lib/api";
import type { ProgressResponse } from "@/lib/types";

const POLL_MS = 2_000;

export function ProgressWidget() {
  const { activeDataset, datasetMeta } = useDashboard();
  const accent = datasetMeta?.theme.accent ?? "#64748b";
  const reducedMotion = useReducedMotion();

  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const mountedRef = useRef(true);

  const poll = useCallback(async () => {
    if (!activeDataset || !mountedRef.current) return;
    try {
      const data = await fetchProgress(activeDataset);
      if (mountedRef.current) setProgress(data);
    } catch {
      // Non-critical — silently skip, widget shows last known value
    }
  }, [activeDataset]);

  // Reset on dataset switch
  useEffect(() => {
    setProgress(null);
    mountedRef.current = true;
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [poll]);

  const percent = progress?.percent ?? 0;
  const rowsProcessed = progress?.rows_processed ?? 0;
  const totalRows = progress?.total_rows ?? 0;

  return (
    <Card className="shadow-sm" aria-label="Dataset progress">
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
            Dataset progress
          </p>
          <span
            className="text-sm font-semibold tabular-nums"
            style={{ color: accent }}
            aria-live="polite"
            aria-atomic="true"
          >
            {percent.toFixed(1)}%
          </span>
        </div>

        {/* Progress track */}
        <div
          className="relative h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-valuenow={Math.round(percent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${percent.toFixed(1)}% of dataset processed`}
        >
          <motion.div
            className="absolute inset-y-0 left-0 w-full origin-left rounded-full"
            style={{ backgroundColor: accent }}
            initial={false}
            animate={{ scaleX: Math.min(percent, 100) / 100 }}
            transition={
              reducedMotion
                ? { duration: 0 }
                : { type: "spring", stiffness: 60, damping: 18 }
            }
          />
        </div>

        {/* Row count */}
        <p className="text-[10px] text-muted-foreground tabular-nums">
          {totalRows > 0
            ? `${rowsProcessed.toLocaleString()} / ${totalRows.toLocaleString()} rows`
            : "Waiting for stream…"}
        </p>
      </CardContent>
    </Card>
  );
}
