"use client";

/**
 * KpiCards — T25
 * Four KPI summary cards from SSE aggregates.
 * All numbers tabular-nums. No layout jitter.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDashboard } from "@/context/DashboardContext";
import type { StreamAggregates } from "@/lib/types";

interface KpiCardsProps {
  aggregates: StreamAggregates;
}

interface KpiCardProps {
  label: string;
  value: string;
  subValue?: string;
  accentColor?: string;
}

function KpiCard({ label, value, subValue, accentColor }: KpiCardProps) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className="text-2xl font-bold tabular-nums leading-tight"
          style={accentColor ? { color: accentColor } : {}}
        >
          {value}
        </div>
        {subValue && (
          <div className="text-xs text-muted-foreground tabular-nums mt-0.5">
            {subValue}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function KpiCards({ aggregates }: KpiCardsProps) {
  const { datasetMeta } = useDashboard();
  const accent = datasetMeta?.theme.accent ?? "#64748b";
  const positiveLabel = datasetMeta?.positive_label ?? "Positive";

  const positiveRate =
    aggregates.total_processed > 0
      ? ((aggregates.positive_count / aggregates.total_processed) * 100).toFixed(1)
      : "0.0";

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard
        label="Total Processed"
        value={aggregates.total_processed.toLocaleString()}
        subValue="events"
      />
      <KpiCard
        label={`${positiveLabel}s Caught`}
        value={aggregates.positive_count.toLocaleString()}
        subValue={`${positiveRate}% rate`}
        accentColor={accent}
      />
      <KpiCard
        label="Avg Latency"
        value={`${aggregates.avg_latency.toFixed(1)}`}
        subValue="ms per inference"
      />
      <KpiCard
        label="Throughput"
        value={`${aggregates.throughput.toFixed(1)}`}
        subValue="events / second"
      />
    </div>
  );
}
