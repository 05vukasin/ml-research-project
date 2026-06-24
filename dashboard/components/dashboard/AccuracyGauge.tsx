"use client";

/**
 * AccuracyGauge — T22 HERO
 *
 * Custom SVG radial arc gauge animated with a Motion spring.
 * - stiffness ~120, damping ~20 per design-taste spec
 * - prefers-reduced-motion: instant snap
 * - Fill color = active dataset accent from registry
 * - All numbers tabular-nums
 */
import { useEffect, useRef, useState } from "react";
import {
  useMotionValue,
  useSpring,
  useTransform,
  useMotionValueEvent,
  motion,
  useReducedMotion,
  type MotionValue,
} from "framer-motion";
import { useDashboard } from "@/context/DashboardContext";
import { Card, CardContent } from "@/components/ui/card";

interface AccuracyGaugeProps {
  accuracy: number;      // 0–1
  totalProcessed: number;
  dataset: string;
}

const SIZE = 260;
const STROKE_WIDTH = 20;
const R = (SIZE - STROKE_WIDTH) / 2;
const CX = SIZE / 2;
const CY = SIZE / 2;

// Arc spans from -210° to +30° (240° total sweep) — classic gauge shape
const START_ANGLE = -210;
const END_ANGLE = 30;
const TOTAL_SWEEP = END_ANGLE - START_ANGLE; // 240°

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number
): string {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

const TRACK_PATH = describeArc(CX, CY, R, START_ANGLE, END_ANGLE);
const TRACK_LENGTH = Math.PI * 2 * R * (TOTAL_SWEEP / 360);

export function AccuracyGauge({
  accuracy,
  totalProcessed,
  dataset,
}: AccuracyGaugeProps) {
  const { datasetMeta } = useDashboard();
  const accent = datasetMeta?.theme.accent ?? "#64748b";
  const positiveLabel = datasetMeta?.positive_label ?? "Positive";

  const reducedMotion = useReducedMotion();

  // Spring-animated value (0–1)
  const rawValue = useMotionValue(0);
  const springValue = useSpring(rawValue, {
    stiffness: 120,
    damping: 20,
    mass: 1,
  });

  // Arc fill: dashoffset from TRACK_LENGTH (empty) → 0 (full)
  const dashOffset = useTransform(springValue, (v: number) =>
    TRACK_LENGTH * (1 - v)
  );

  // Percent label as integer 0–100, synced to React state for JSX rendering
  const [displayPercent, setDisplayPercent] = useState(0);
  useMotionValueEvent(springValue, "change", (latest: number) => {
    setDisplayPercent(Math.round(latest * 100));
  });

  const prevRef = useRef(0);

  useEffect(() => {
    if (reducedMotion) {
      // Instant snap — no spring
      rawValue.jump(accuracy);
    } else {
      rawValue.set(accuracy);
    }
    prevRef.current = accuracy;
  }, [accuracy, rawValue, reducedMotion]);

  return (
    <Card className="flex flex-col items-center justify-center p-6 shadow-sm">
      <CardContent className="flex flex-col items-center gap-4 p-0">
        {/* Hero label */}
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
          Running Accuracy
        </div>

        {/* SVG Gauge */}
        <div
          role="img"
          aria-label={`Accuracy gauge: ${Math.round(accuracy * 100)}%`}
          className="relative"
          style={{ width: SIZE, height: SIZE }}
        >
          <svg
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            aria-hidden="true"
          >
            {/* Track (background arc) */}
            <path
              d={TRACK_PATH}
              fill="none"
              stroke="#e2e8f0"
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
            />

            {/* Animated fill arc */}
            <motion.path
              d={TRACK_PATH}
              fill="none"
              stroke={accent}
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
              strokeDasharray={TRACK_LENGTH}
              style={{ strokeDashoffset: dashOffset }}
            />
          </svg>

          {/* Center text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 select-none">
            <span
              className="text-5xl font-bold tabular-nums leading-none"
              style={{ color: accent }}
            >
              {displayPercent}
              <span className="text-2xl font-semibold">%</span>
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {totalProcessed.toLocaleString()} events
            </span>
          </div>
        </div>

        {/* Dataset label */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className="inline-block size-2 rounded-full"
            style={{ backgroundColor: accent }}
            aria-hidden="true"
          />
          <span>
            Dataset: <span className="font-medium text-foreground">{dataset || "—"}</span>
          </span>
          <span className="text-muted-foreground/50">·</span>
          <span>Positive: {positiveLabel}</span>
        </div>
      </CardContent>
    </Card>
  );
}
