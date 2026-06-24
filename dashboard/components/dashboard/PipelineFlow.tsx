"use client";

/**
 * PipelineFlow — T24
 *
 * @xyflow/react schematic: Stream → Model → DB
 * Animated edges; edge animation speed scales with throughput.
 * Model node shows an in-flight counter from recent events.
 * Calm, secondary to the gauge.
 */
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { useDashboard } from "@/context/DashboardContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface PipelineFlowProps {
  throughput: number;
  inFlightCount?: number;
}

function buildNodes(
  accent: string,
  throughput: number,
  inFlightCount: number
): Node[] {
  const baseStyle: React.CSSProperties = {
    borderRadius: 10,
    border: "1.5px solid #e2e8f0",
    background: "#fff",
    padding: "8px 14px",
    fontSize: 12,
    fontWeight: 500,
    color: "#1e293b",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    width: 110,
    textAlign: "center" as const,
  };

  return [
    {
      id: "stream",
      position: { x: 20, y: 60 },
      data: { label: "Stream" },
      style: { ...baseStyle },
    },
    {
      id: "model",
      position: { x: 170, y: 60 },
      data: {
        label: (
          <div className="flex flex-col items-center gap-0.5">
            <span>Model</span>
            {inFlightCount > 0 && (
              <span
                className="text-[10px] font-semibold tabular-nums rounded-full px-1.5 py-0.5 text-white leading-none"
                style={{ backgroundColor: accent }}
              >
                +{inFlightCount}
              </span>
            )}
          </div>
        ),
      },
      style: {
        ...baseStyle,
        borderColor: throughput > 0 ? accent : "#e2e8f0",
        borderWidth: throughput > 0 ? 2 : 1.5,
      },
    },
    {
      id: "db",
      position: { x: 320, y: 60 },
      data: { label: "Postgres" },
      style: { ...baseStyle },
    },
  ];
}

function buildEdges(throughput: number, accent: string): Edge[] {
  // Scale animation duration: faster throughput = faster edge animation
  // clamp between 0.3s (fast) and 2s (idle)
  const duration = throughput > 0 ? Math.max(0.3, 2 / throughput) : 2;

  const edgeStyle: React.CSSProperties = {
    stroke: throughput > 0 ? accent : "#cbd5e1",
    strokeWidth: throughput > 0 ? 2 : 1.5,
    opacity: throughput > 0 ? 0.8 : 0.4,
  };

  return [
    {
      id: "stream-model",
      source: "stream",
      target: "model",
      animated: throughput > 0,
      style: edgeStyle,
      // Edge label with throughput
      label: throughput > 0 ? `${throughput.toFixed(1)}/s` : undefined,
      labelStyle: {
        fontSize: 9,
        fontWeight: 500,
        fill: "#94a3b8",
      },
      labelBgStyle: { fill: "transparent" },
    },
    {
      id: "model-db",
      source: "model",
      target: "db",
      animated: throughput > 0,
      style: edgeStyle,
    },
  ];
}

export function PipelineFlow({
  throughput,
  inFlightCount = 0,
}: PipelineFlowProps) {
  const { datasetMeta } = useDashboard();
  const accent = datasetMeta?.theme.accent ?? "#64748b";

  const nodes = useMemo(
    () => buildNodes(accent, throughput, inFlightCount),
    [accent, throughput, inFlightCount]
  );

  const edges = useMemo(
    () => buildEdges(throughput, accent),
    [throughput, accent]
  );

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-foreground">
          Pipeline
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {throughput > 0
            ? `${throughput.toFixed(1)} events/s`
            : "Idle"}
        </p>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <div
          className="w-full rounded-lg overflow-hidden border border-border bg-slate-50/50"
          style={{ height: 130 }}
          aria-label="Pipeline flow: Stream to Model to Postgres"
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            zoomOnScroll={false}
            zoomOnPinch={false}
            panOnDrag={false}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={16}
              size={1}
              color="#e2e8f0"
            />
          </ReactFlow>
        </div>
      </CardContent>
    </Card>
  );
}
