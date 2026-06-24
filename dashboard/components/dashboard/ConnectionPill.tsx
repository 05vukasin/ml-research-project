"use client";

import { cn } from "@/lib/utils";
import type { ConnectionStatus } from "@/lib/types";

interface ConnectionPillProps {
  status: ConnectionStatus;
}

const LABELS: Record<ConnectionStatus, string> = {
  connected: "Live",
  connecting: "Connecting",
  disconnected: "Offline",
};

export function ConnectionPill({ status }: ConnectionPillProps) {
  return (
    <div
      role="status"
      aria-label={`Stream status: ${LABELS[status]}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums transition-colors duration-300",
        status === "connected" &&
          "border-green-200 bg-green-50 text-green-700",
        status === "connecting" &&
          "border-amber-200 bg-amber-50 text-amber-700",
        status === "disconnected" &&
          "border-red-200 bg-red-50 text-red-700"
      )}
    >
      {/* Status dot — motion removed for screen readers via aria-hidden */}
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          status === "connected" && "bg-green-500 animate-pulse",
          status === "connecting" && "bg-amber-500 animate-pulse",
          status === "disconnected" && "bg-red-500"
        )}
      />
      {LABELS[status]}
    </div>
  );
}
