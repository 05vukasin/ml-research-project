"use client";

/**
 * Monitoring — T53
 *
 * Bento layout: half-width service cards (postgres, inference, trainer, streamer)
 * + a full-width interactive Redis queue panel with animated message flow,
 * a live throughput sparkline, pubsub info, and memory/clients/ops stats.
 *
 * Polls fetchMonitoring() every 1.5s; fetchTrainerStats() every 5s.
 * Pauses polling when the document is hidden (nice-to-have via visibilitychange).
 * Respects prefers-reduced-motion; animates only transform/opacity for 60fps.
 */
import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import {
  Database,
  Cpu,
  Zap,
  Activity,
  Radio,
  WifiOff,
  Clock,
  Users,
  MemoryStick,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchMonitoring, fetchTrainerStats } from "@/lib/api";
import type { MonitoringSnapshot, TrainerStats } from "@/lib/types";
import { cn } from "@/lib/utils";

// ── Constants ────────────────────────────────────────────────────────

const MONITORING_POLL_MS = 1_500;
const TRAINER_POLL_MS = 5_000;
/** Max throughput sparkline history points (covers ~30s at 1.5s poll) */
const MAX_SPARKLINE = 20;
/** Max animated packets on the Redis track at once */
const MAX_PACKETS = 8;

// ── Types ─────────────────────────────────────────────────────────────

type ServiceState = "ok" | "degraded" | "down" | "loading";

interface SparkPoint {
  t: number;
  v: number;
}

interface Packet {
  id: number;
  key: number;
}

// ── Helpers ───────────────────────────────────────────────────────────

function formatUptime(s: number): string {
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatMemory(mb: number): string {
  return mb < 1 ? `${(mb * 1024).toFixed(0)} KB` : `${mb.toFixed(2)} MB`;
}

function snapState(status: string | undefined, reason?: string): ServiceState {
  if (!status) return "loading";
  if (status === "ok") return "ok";
  if (status === "unknown") return "degraded";
  return "down";
}

// ── StatusDot ─────────────────────────────────────────────────────────

interface StatusDotProps {
  state: ServiceState;
}

function StatusDot({ state }: StatusDotProps) {
  const colorMap: Record<ServiceState, string> = {
    ok: "bg-emerald-500",
    degraded: "bg-amber-400",
    down: "bg-red-500",
    loading: "bg-slate-300",
  };
  const label: Record<ServiceState, string> = {
    ok: "Operational",
    degraded: "Degraded",
    down: "Down",
    loading: "Checking…",
  };
  return (
    <span
      className={cn(
        "inline-block size-2 rounded-full shrink-0",
        colorMap[state]
      )}
      role="img"
      aria-label={label[state]}
    />
  );
}

// ── StatRow ───────────────────────────────────────────────────────────

interface StatRowProps {
  label: string;
  value: string;
  muted?: boolean;
}

function StatRow({ label, value, muted }: StatRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-xs font-medium tabular-nums",
          muted ? "text-muted-foreground" : "text-foreground"
        )}
      >
        {value}
      </span>
    </div>
  );
}

// ── ServiceCard ───────────────────────────────────────────────────────

interface ServiceCardProps {
  icon: React.ReactNode;
  name: string;
  state: ServiceState;
  reason?: string;
  children?: React.ReactNode;
}

function ServiceCard({ icon, name, state, reason, children }: ServiceCardProps) {
  const isDown = state === "down" || state === "degraded";
  return (
    <Card
      className={cn(
        "shadow-sm transition-colors",
        isDown && "opacity-70"
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-muted-foreground",
              state === "ok" && "text-slate-600",
              isDown && "text-slate-400"
            )}
          >
            {icon}
          </span>
          <CardTitle className="text-sm font-semibold text-foreground">
            {name}
          </CardTitle>
          <StatusDot state={state} />
          {state === "degraded" && (
            <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300 ml-auto">
              Stale
            </Badge>
          )}
          {state === "down" && (
            <Badge variant="outline" className="text-[10px] text-red-500 border-red-300 ml-auto">
              Down
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isDown && reason ? (
          <div className="flex items-start gap-1.5 rounded-md bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-600">
            <AlertCircle className="size-3 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{reason}</span>
          </div>
        ) : (
          <div className="divide-y divide-border/50">{children}</div>
        )}
      </CardContent>
    </Card>
  );
}

// ── AnimatedPacket ────────────────────────────────────────────────────

interface AnimatedPacketProps {
  id: number;
  reducedMotion: boolean;
}

function AnimatedPacket({ id, reducedMotion }: AnimatedPacketProps) {
  return (
    <motion.span
      key={id}
      className="absolute top-1/2 size-2 rounded-full bg-indigo-500"
      style={{ translateY: "-50%" }}
      initial={{ left: "0%", opacity: 0 }}
      animate={{ left: "100%", opacity: [0, 1, 1, 0] }}
      exit={{ opacity: 0 }}
      transition={
        reducedMotion
          ? { duration: 0 }
          : {
              left: { duration: 2.5, ease: "linear" },
              opacity: { duration: 2.5, times: [0, 0.08, 0.9, 1], ease: "linear" },
            }
      }
      aria-hidden="true"
    />
  );
}

// ── ThroughputSparkline ───────────────────────────────────────────────

interface ThroughputSparklineProps {
  data: SparkPoint[];
}

function ThroughputSparkline({ data }: ThroughputSparklineProps) {
  return (
    <ResponsiveContainer width="100%" height={40}>
      <AreaChart data={data} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
        <defs>
          <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="v"
          stroke="#6366f1"
          strokeWidth={1.5}
          fill="url(#spark-grad)"
          dot={false}
          isAnimationActive={false}
        />
        <RechartsTooltip
          content={() => null}
          cursor={{ stroke: "#6366f1", strokeWidth: 1, strokeDasharray: "3 3" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── RedisPanel ────────────────────────────────────────────────────────

interface RedisPanelProps {
  redis: MonitoringSnapshot["redis"] | null;
  throughput: number;
  reducedMotion: boolean;
  sparkData: SparkPoint[];
}

function RedisPanel({ redis, throughput, reducedMotion, sparkData }: RedisPanelProps) {
  const [packets, setPackets] = useState<Packet[]>([]);
  const packetCounter = useRef(0);

  // Spawn packets proportional to throughput (capped)
  useEffect(() => {
    if (reducedMotion || !throughput) return;
    const rate = Math.max(200, Math.min(3000, 3000 / (throughput + 1)));
    const id = setInterval(() => {
      setPackets((prev) => {
        // Append a new packet and keep only the most recent MAX_PACKETS.
        const next = [
          ...prev,
          { id: packetCounter.current++, key: packetCounter.current },
        ].slice(-MAX_PACKETS);
        return next;
      });
    }, rate);
    return () => clearInterval(id);
  }, [throughput, reducedMotion]);

  const state = redis ? snapState(redis.status) : "loading";

  return (
    <Card className="shadow-sm col-span-2">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Radio className="size-4 text-indigo-500" aria-hidden="true" />
          <CardTitle className="text-sm font-semibold text-foreground">
            Redis Pub/Sub
          </CardTitle>
          <StatusDot state={state} />
          {redis && (
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              v{redis.version}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0 flex flex-col gap-4">
        {!redis ? (
          <Skeleton className="h-20 rounded-lg" />
        ) : (
          <>
            {/* Message flow track */}
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Message flow
              </p>
              <div className="flex items-center gap-3">
                {/* Streamer label */}
                <span className="shrink-0 text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                  Streamer
                </span>
                {/* Animated track */}
                <div
                  className="relative flex-1 h-6 rounded-full bg-slate-100 border border-slate-200 overflow-hidden"
                  aria-label="Message flow track from Streamer through Redis to Inference"
                  role="img"
                >
                  {/* Redis midpoint marker */}
                  <span className="absolute inset-y-0 left-1/2 -translate-x-1/2 flex items-center">
                    <span className="size-3 rounded-full bg-indigo-100 border border-indigo-300 flex items-center justify-center">
                      <span className="size-1.5 rounded-full bg-indigo-400" aria-hidden="true" />
                    </span>
                  </span>
                  {/* Flowing packets */}
                  <AnimatePresence>
                    {packets.map((p) => (
                      <AnimatedPacket
                        key={p.id}
                        id={p.id}
                        reducedMotion={reducedMotion}
                      />
                    ))}
                  </AnimatePresence>
                </div>
                {/* Inference label */}
                <span className="shrink-0 text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                  Inference
                </span>
              </div>
              {/* Mid label */}
              <div className="flex justify-center mt-1">
                <span className="text-[10px] text-indigo-500 font-medium">Redis</span>
              </div>
            </div>

            {/* Throughput sparkline */}
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
                Throughput (msg/s)
              </p>
              <ThroughputSparkline data={sparkData} />
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-0">
              <div className="divide-y divide-border/50">
                <StatRow
                  label="Used memory"
                  value={formatMemory(redis.used_memory_mb)}
                />
                <StatRow
                  label="Connected clients"
                  value={redis.connected_clients.toString()}
                />
                <StatRow
                  label="Ops/sec"
                  value={redis.ops_per_sec.toLocaleString()}
                />
              </div>
              <div className="divide-y divide-border/50">
                <StatRow
                  label="transactions subscribers"
                  value={(redis.pubsub?.["transactions"] ?? 0).toString()}
                />
                <StatRow
                  label="control subscribers"
                  value={(redis.pubsub?.["control"] ?? 0).toString()}
                />
                <StatRow
                  label="Status"
                  value={redis.status === "ok" ? "Operational" : "Error"}
                />
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main ──────────────────────────────────────────────────────────────

export function Monitoring() {
  const reducedMotion = useReducedMotion() ?? false;
  const [snap, setSnap] = useState<MonitoringSnapshot | null>(null);
  const [trainer, setTrainer] = useState<TrainerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Live throughput sparkline history (fed from inference throughput)
  const [sparkData, setSparkData] = useState<SparkPoint[]>([]);

  const monInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const trainerInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollMonitoring = useCallback(async () => {
    if (document.hidden) return;
    try {
      const s = await fetchMonitoring();
      setSnap(s);
      setLoading(false);
      setError(null);
      // Accumulate sparkline
      const throughput = s.inference?.throughput ?? 0;
      setSparkData((prev) => {
        const next = [...prev, { t: Date.now(), v: throughput }];
        return next.slice(-MAX_SPARKLINE);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch monitoring");
      setLoading(false);
    }
  }, []);

  const pollTrainer = useCallback(async () => {
    if (document.hidden) return;
    try {
      const t = await fetchTrainerStats();
      setTrainer(t);
    } catch {
      // Trainer might be unavailable; show degraded state silently
      setTrainer({ status: "down" });
    }
  }, []);

  useEffect(() => {
    pollMonitoring();
    pollTrainer();
    monInterval.current = setInterval(pollMonitoring, MONITORING_POLL_MS);
    trainerInterval.current = setInterval(pollTrainer, TRAINER_POLL_MS);
    return () => {
      if (monInterval.current) clearInterval(monInterval.current);
      if (trainerInterval.current) clearInterval(trainerInterval.current);
    };
  }, [pollMonitoring, pollTrainer]);

  // ── Derived states ─────────────────────────────────────────────────

  const pgState = snap ? snapState(snap.postgres.status) : "loading";
  const infState = snap ? snapState(snap.inference.status) : "loading";
  const strState = snap ? snapState(snap.streamer.status, snap.streamer.reason) : "loading";
  const trainerState: ServiceState = !trainer
    ? "loading"
    : trainer.status === "ok"
    ? "ok"
    : trainer.status === "down"
    ? "down"
    : "degraded";

  const inferenceThroughput = snap?.inference?.throughput ?? 0;

  // ── Error state ────────────────────────────────────────────────────

  if (error && !snap) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-red-200 bg-red-50 p-12 text-center">
        <WifiOff className="size-8 text-red-400" aria-hidden="true" />
        <p className="text-sm font-medium text-red-700">
          Monitoring endpoint unavailable
        </p>
        <p className="text-xs text-red-500">{error}</p>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col gap-4"
      aria-label="System monitoring dashboard"
    >
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            System Monitoring
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Live service health and Redis queue activity
          </p>
        </div>
        {loading && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <RefreshCw className="size-3 animate-spin" aria-hidden="true" />
            Polling…
          </div>
        )}
      </div>

      {/* Bento grid: 2-column on desktop, 1-column on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Postgres card */}
        {loading && !snap ? (
          <Skeleton className="h-48 rounded-xl" />
        ) : (
          <ServiceCard
            icon={<Database className="size-4" aria-hidden="true" />}
            name="PostgreSQL"
            state={pgState}
            reason={snap?.postgres.status !== "ok" ? "Database unavailable" : undefined}
          >
            <StatRow
              label="DB size"
              value={snap ? `${snap.postgres.db_size_mb.toFixed(2)} MB` : "—"}
            />
            <StatRow
              label="Total predictions"
              value={snap ? snap.postgres.predictions_total.toLocaleString() : "—"}
            />
            <StatRow
              label="Connections"
              value={snap ? snap.postgres.connections.toString() : "—"}
            />
            {snap && Object.keys(snap.postgres.predictions_by_dataset).length > 0 && (
              <div className="pt-2">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  By dataset
                </p>
                {Object.entries(snap.postgres.predictions_by_dataset).map(
                  ([ds, count]) => (
                    <StatRow
                      key={ds}
                      label={ds}
                      value={count.toLocaleString()}
                      muted
                    />
                  )
                )}
              </div>
            )}
          </ServiceCard>
        )}

        {/* Inference card */}
        {loading && !snap ? (
          <Skeleton className="h-48 rounded-xl" />
        ) : (
          <ServiceCard
            icon={<Cpu className="size-4" aria-hidden="true" />}
            name="Inference"
            state={infState}
            reason={snap?.inference.status !== "ok" ? "Inference service unavailable" : undefined}
          >
            <StatRow
              label="Models loaded"
              value={snap ? snap.inference.models_loaded.toString() : "—"}
            />
            <StatRow
              label="Active dataset"
              value={snap ? snap.inference.active_dataset : "—"}
            />
            <StatRow
              label="Active model"
              value={snap ? snap.inference.active_model : "—"}
            />
            <StatRow
              label="Throughput"
              value={snap ? `${snap.inference.throughput.toFixed(2)} msg/s` : "—"}
            />
            <StatRow
              label="Avg latency"
              value={snap ? `${snap.inference.avg_latency_ms.toFixed(1)} ms` : "—"}
            />
            <StatRow
              label="SSE subscribers"
              value={snap ? snap.inference.sse_subscribers.toString() : "—"}
            />
            <StatRow
              label="Uptime"
              value={snap ? formatUptime(snap.inference.uptime_s) : "—"}
            />
          </ServiceCard>
        )}

        {/* Trainer card */}
        {loading && !trainer ? (
          <Skeleton className="h-32 rounded-xl" />
        ) : (
          <ServiceCard
            icon={<Zap className="size-4" aria-hidden="true" />}
            name="Trainer"
            state={trainerState}
            reason={trainerState === "down" ? "Trainer service unavailable" : undefined}
          >
            <StatRow
              label="Status"
              value={trainer?.status === "ok" ? "Operational" : (trainer?.status ?? "—")}
            />
            <StatRow
              label="Endpoint"
              value="trainer:8001"
              muted
            />
          </ServiceCard>
        )}

        {/* Streamer card */}
        {loading && !snap ? (
          <Skeleton className="h-32 rounded-xl" />
        ) : (
          <ServiceCard
            icon={<Activity className="size-4" aria-hidden="true" />}
            name="Streamer"
            state={strState}
            reason={snap?.streamer.reason}
          >
            {strState !== "down" && snap?.streamer.status === "ok" ? (
              <StatRow label="Status" value="Operational" />
            ) : strState === "degraded" ? (
              <div className="flex items-start gap-1.5 rounded-md bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-700">
                <AlertCircle className="size-3 mt-0.5 shrink-0" aria-hidden="true" />
                <span>{snap?.streamer.reason ?? "Status unknown"}</span>
              </div>
            ) : (
              <StatRow label="Status" value={snap?.streamer.status ?? "—"} />
            )}
          </ServiceCard>
        )}

        {/* Full-width Redis panel */}
        <RedisPanel
          redis={snap?.redis ?? null}
          throughput={inferenceThroughput}
          reducedMotion={reducedMotion}
          sparkData={sparkData}
        />
      </div>
    </div>
  );
}
