"use client";

/**
 * LiveFeed — T23 + T48
 *
 * AnimatePresence-driven feed of the most recent inference events.
 * - Fixed height (h-[420px]) — card never resizes as rows arrive.
 * - Rows scroll/pop within the fixed container; AnimatePresence popLayout.
 * - Play/pause button in the CardHeader wired to the shared paused state
 *   in DashboardContext (single source of truth shared with SettingsPopup).
 * - Rows keyed by event id; enter = fade + slide from top (280ms ease-out)
 * - Positive class rows: accent left-border + one-shot pulse (not looping)
 * - ✓/✗ text labels (not color-only) for correct/incorrect
 * - All numbers tabular-nums; no layout jitter
 * - Bounded to last 40 events via useLiveStream
 */
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Pause, Play } from "lucide-react";
import { useDashboard } from "@/context/DashboardContext";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StreamEvent } from "@/lib/types";

interface LiveFeedProps {
  events: StreamEvent[];
}

function FeedRow({
  event,
  onSelect,
}: {
  event: StreamEvent;
  onSelect: (e: StreamEvent) => void;
}) {
  const { datasetMeta } = useDashboard();
  const accent = datasetMeta?.theme.accent ?? "#64748b";
  const isPositive = event.prediction === 1;
  const isCorrect = event.is_correct;

  return (
    <motion.li
      key={event.id}
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      role="button"
      tabIndex={0}
      aria-label={`Inspect event ${event.id}`}
      onClick={() => onSelect(event)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(event);
        }
      }}
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-xs bg-white cursor-pointer transition-shadow hover:shadow-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        isPositive && "pulse-once"
      )}
      style={
        isPositive
          ? { borderLeftWidth: 3, borderLeftColor: accent }
          : {}
      }
    >
      {/* Correct / incorrect — text + color, not color-only */}
      <span
        className={cn(
          "shrink-0 w-5 text-center font-bold tabular-nums",
          isCorrect ? "text-green-600" : "text-red-500"
        )}
        aria-label={isCorrect ? "Correct" : "Incorrect"}
      >
        {isCorrect ? "✓" : "✗"}
      </span>

      {/* Prediction vs actual */}
      <div className="flex items-center gap-1 font-medium min-w-0 shrink-0">
        <span
          className="tabular-nums"
          style={{ color: event.prediction === 1 ? accent : "#64748b" }}
        >
          {event.prediction === 1
            ? (datasetMeta?.positive_label ?? "Pos")
            : (datasetMeta?.models[0]?.classes?.["0"] ?? "Neg")}
        </span>
        <span className="text-muted-foreground/60">→</span>
        <span className="tabular-nums text-muted-foreground">
          {event.actual === 1
            ? (datasetMeta?.positive_label ?? "Pos")
            : (datasetMeta?.models[0]?.classes?.["0"] ?? "Neg")}
        </span>
      </div>

      {/* Probability */}
      <div className="ml-auto flex items-center gap-3 text-muted-foreground shrink-0">
        <span className="tabular-nums">
          <span className="text-muted-foreground/70">p=</span>
          {(event.probability * 100).toFixed(1)}
          <span className="text-muted-foreground/70">%</span>
        </span>
        <span className="tabular-nums text-muted-foreground/70">
          {event.latency_ms.toFixed(1)}
          <span className="text-muted-foreground/50">ms</span>
        </span>
        <span
          className={cn(
            "shrink-0 w-16 text-right tabular-nums",
            isPositive ? "font-semibold" : "text-muted-foreground/50"
          )}
          style={isPositive ? { color: accent } : {}}
        >
          {isPositive && (
            <span className="text-[10px] font-medium uppercase tracking-wide">
              {datasetMeta?.positive_label ?? "Alert"}
            </span>
          )}
        </span>
      </div>
    </motion.li>
  );
}

/** Modal showing the exact content of a single live event. */
function EventDetailDialog({
  event,
  onClose,
}: {
  event: StreamEvent | null;
  onClose: () => void;
}) {
  const { datasetMeta } = useDashboard();
  const accent = datasetMeta?.theme.accent ?? "#64748b";
  const negLabel = datasetMeta?.models[0]?.classes?.["0"] ?? "Neg";
  const posLabel = datasetMeta?.positive_label ?? "Pos";
  const label = (v: number) => (v === 1 ? posLabel : negLabel);

  const rows: { k: string; v: string }[] = event
    ? [
        { k: "Event ID", v: String(event.id) },
        { k: "Dataset", v: event.dataset },
        { k: "Prediction", v: `${label(event.prediction)} (${event.prediction})` },
        { k: "Actual", v: `${label(event.actual)} (${event.actual})` },
        { k: "Correct", v: event.is_correct ? "Yes ✓" : "No ✗" },
        { k: "Probability", v: `${(event.probability * 100).toFixed(2)}%` },
        { k: "Latency", v: `${event.latency_ms.toFixed(2)} ms` },
        { k: "Timestamp", v: new Date(event.ts).toLocaleString() },
        { k: "Running accuracy", v: `${(event.running_accuracy * 100).toFixed(2)}%` },
        { k: "Total processed", v: event.total_processed.toLocaleString() },
        { k: "Positives caught", v: event.positive_count.toLocaleString() },
        { k: "Throughput", v: `${event.throughput.toFixed(2)} /s` },
        { k: "Avg latency", v: `${event.avg_latency.toFixed(2)} ms` },
      ]
    : [];

  return (
    <Dialog open={event !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <span>Event #{event?.id}</span>
            {event && (
              <>
                <Badge variant="outline" className="text-[10px] font-medium">
                  {datasetMeta?.label ?? event.dataset}
                </Badge>
                <span
                  className={cn(
                    "text-xs font-bold",
                    event.is_correct ? "text-green-600" : "text-red-500"
                  )}
                >
                  {event.is_correct ? "✓ correct" : "✗ incorrect"}
                </span>
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        {event && (
          <div className="flex flex-col gap-3">
            {/* Readable field grid */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              {rows.map((r) => (
                <div key={r.k} className="flex flex-col">
                  <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {r.k}
                  </dt>
                  <dd className="tabular-nums font-medium text-foreground">{r.v}</dd>
                </div>
              ))}
            </dl>

            {/* Exact raw payload */}
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Raw event JSON
              </p>
              <pre
                className="max-h-48 overflow-auto rounded-md bg-slate-50 border border-border p-3 text-[11px] leading-relaxed tabular-nums"
                style={{ borderLeftWidth: 3, borderLeftColor: accent }}
              >
                {JSON.stringify(event, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function LiveFeed({ events }: LiveFeedProps) {
  const { paused, setPaused } = useDashboard();
  const [selected, setSelected] = useState<StreamEvent | null>(null);

  return (
    <Card className="flex flex-col shadow-sm h-[420px]">
      <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-sm font-semibold text-foreground">
            Live Events
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Latest {events.length} predictions
          </p>
        </div>
        {/* Play/pause — shared state with SettingsPopup */}
        <Button
          variant="ghost"
          size="icon"
          aria-label={paused ? "Resume stream" : "Pause stream"}
          aria-pressed={paused}
          title={paused ? "Resume stream" : "Pause stream"}
          className="size-7 text-muted-foreground hover:text-foreground shrink-0"
          onClick={() => setPaused(!paused)}
        >
          {paused ? (
            <Play className="size-3.5" aria-hidden="true" />
          ) : (
            <Pause className="size-3.5" aria-hidden="true" />
          )}
        </Button>
      </CardHeader>
      {paused && (
        <div
          role="status"
          className="mx-3 mb-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-1.5 text-[11px] font-medium text-amber-700"
        >
          Stream paused — no new predictions are flowing.
        </div>
      )}
      <CardContent className="flex-1 overflow-hidden p-3 pt-0 min-h-0">
        <motion.ul
          className="flex flex-col gap-1.5 overflow-y-auto h-full pr-1"
          aria-label="Live inference events"
          aria-live="polite"
          aria-atomic="false"
          aria-relevant="additions"
        >
          <AnimatePresence initial={false} mode="popLayout">
            {events.map((event) => (
              <FeedRow key={event.id} event={event} onSelect={setSelected} />
            ))}
          </AnimatePresence>
          {events.length === 0 && (
            <li className="flex items-center justify-center h-24 text-xs text-muted-foreground">
              Waiting for stream…
            </li>
          )}
        </motion.ul>
      </CardContent>

      <EventDetailDialog event={selected} onClose={() => setSelected(null)} />
    </Card>
  );
}
