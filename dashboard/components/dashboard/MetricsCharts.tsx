"use client";

/**
 * MetricsCharts — T25
 * Recharts area chart for accuracy over time (from GET /metrics accuracy_over_time).
 * Polls every 3s. Confusion matrix. Updates on active dataset change.
 * Throughput/latency come from SSE aggregates (passed as props).
 */
import { useEffect, useState, useCallback, useRef } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboard } from "@/context/DashboardContext";
import { fetchMetrics } from "@/lib/api";
import type { MetricsResponse, StreamAggregates } from "@/lib/types";

const POLL_INTERVAL_MS = 3_000;

// Recharts formatter helpers — typed loosely to avoid Recharts complex generic types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const formatPercent = (v: any) => [`${(Number(v) * 100).toFixed(2)}%`, "Accuracy"];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const formatRate = (v: any) => [`${Number(v).toFixed(2)}`, "req/s"];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const formatLatency = (v: any) => [`${Number(v).toFixed(1)} ms`, "Latency"];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const labelFormatTime = (label: any) => formatTime(String(label));

interface ConfusionCellProps {
  label: string;
  value: number;
  highlight?: boolean;
  accentColor?: string;
}

function ConfusionCell({ label, value, highlight, accentColor }: ConfusionCellProps) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-lg border border-border p-3 gap-0.5"
      style={
        highlight && accentColor
          ? { borderColor: accentColor, backgroundColor: `${accentColor}10` }
          : {}
      }
    >
      <span
        className="text-xl font-bold tabular-nums"
        style={highlight && accentColor ? { color: accentColor } : {}}
      >
        {value.toLocaleString()}
      </span>
      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
    </div>
  );
}

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts;
  }
}

// Rolling live data point (SSE-derived)
interface LivePoint {
  ts: string;
  throughput: number;
  latency: number;
}

const MAX_LIVE_HISTORY = 60; // keep 60 data points (~3 min at 1 sample/3s)

interface MetricsChartsProps {
  aggregates: StreamAggregates;
}

export function MetricsCharts({ aggregates }: MetricsChartsProps) {
  const { activeDataset, datasetMeta } = useDashboard();
  const accent = datasetMeta?.theme.accent ?? "#64748b";

  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Rolling history from SSE aggregates (throughput + latency)
  const [liveHistory, setLiveHistory] = useState<LivePoint[]>([]);
  const lastAggRef = useRef<string>("");

  const poll = useCallback(async () => {
    if (!activeDataset) return;
    try {
      const data = await fetchMetrics(activeDataset);
      setMetrics(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [activeDataset]);

  // Reset on dataset change
  useEffect(() => {
    setLoading(true);
    setMetrics(null);
    setLiveHistory([]);
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [poll]);

  // Capture live throughput/latency from SSE aggregates
  useEffect(() => {
    if (!aggregates.dataset) return;
    const key = `${aggregates.throughput}-${aggregates.avg_latency}`;
    if (key === lastAggRef.current) return;
    lastAggRef.current = key;

    const point: LivePoint = {
      ts: new Date().toISOString(),
      throughput: aggregates.throughput,
      latency: aggregates.avg_latency,
    };
    setLiveHistory((prev) => [...prev, point].slice(-MAX_LIVE_HISTORY));
  }, [aggregates.throughput, aggregates.avg_latency, aggregates.dataset]);

  const positiveLabel = datasetMeta?.positive_label ?? "Positive";

  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="shadow-sm">
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-28" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-40 w-full rounded-lg" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error && !metrics) {
    return (
      <div className="rounded-xl border border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        Metrics unavailable: {error}
      </div>
    );
  }

  const accuracyHistory = metrics?.accuracy_over_time ?? [];

  return (
    <div className="flex flex-col gap-4">
      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Accuracy over time (from DB/REST) */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">
              Accuracy over time
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart
                data={accuracyHistory}
                margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="gradAcc" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={accent} stopOpacity={0.18} />
                    <stop offset="95%" stopColor={accent} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="ts"
                  tickFormatter={formatTime}
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
                  formatter={formatPercent as any}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  labelFormatter={labelFormatTime as any}
                />
                <Area
                  type="monotone"
                  dataKey="accuracy"
                  stroke={accent}
                  strokeWidth={2}
                  fill="url(#gradAcc)"
                  dot={false}
                  activeDot={{ r: 4, fill: accent }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Throughput (live from SSE) */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">
              Throughput (req/s)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart
                data={liveHistory}
                margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="gradThr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#64748b" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#64748b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="ts"
                  tickFormatter={formatTime}
                  tick={{ fontSize: 9, fill: "#94a3b8" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: "#94a3b8" }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    fontSize: 11,
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                  }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={formatRate as any}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  labelFormatter={labelFormatTime as any}
                />
                <Area
                  type="monotone"
                  dataKey="throughput"
                  stroke="#64748b"
                  strokeWidth={2}
                  fill="url(#gradThr)"
                  dot={false}
                  activeDot={{ r: 4, fill: "#64748b" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Latency (live from SSE) */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">
              Avg Latency (ms)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart
                data={liveHistory}
                margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="gradLat" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.12} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="ts"
                  tickFormatter={formatTime}
                  tick={{ fontSize: 9, fill: "#94a3b8" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: "#94a3b8" }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    fontSize: 11,
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                  }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={formatLatency as any}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  labelFormatter={labelFormatTime as any}
                />
                <Area
                  type="monotone"
                  dataKey="latency"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  fill="url(#gradLat)"
                  dot={false}
                  activeDot={{ r: 4, fill: "#8b5cf6" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Confusion matrix */}
      {metrics?.confusion && (
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">
              Confusion Matrix
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Positive class: {positiveLabel}
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-2 max-w-sm">
              <ConfusionCell
                label="TP"
                value={metrics.confusion.tp}
                highlight
                accentColor={accent}
              />
              <ConfusionCell label="FP" value={metrics.confusion.fp} />
              <ConfusionCell label="FN" value={metrics.confusion.fn} />
              <ConfusionCell label="TN" value={metrics.confusion.tn} />
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
              {metrics.precision != null && (
                <span>
                  Precision:{" "}
                  <span className="font-semibold tabular-nums text-foreground">
                    {(metrics.precision * 100).toFixed(1)}%
                  </span>
                </span>
              )}
              {metrics.recall != null && (
                <span>
                  Recall:{" "}
                  <span className="font-semibold tabular-nums text-foreground">
                    {(metrics.recall * 100).toFixed(1)}%
                  </span>
                </span>
              )}
              <span>
                Accuracy:{" "}
                <span className="font-semibold tabular-nums text-foreground">
                  {(metrics.accuracy * 100).toFixed(2)}%
                </span>
              </span>
              <span>
                Total:{" "}
                <span className="font-semibold tabular-nums text-foreground">
                  {metrics.total.toLocaleString()}
                </span>
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
