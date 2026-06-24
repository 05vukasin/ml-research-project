"use client";

/**
 * TopNav — T47
 *
 * Slim single-line navigation bar replacing the old DashboardHeader.
 *   LEFT:  branding logo mark + tab links (Dashboard · Training Lab · Monitoring)
 *          with the Motion layoutId="tab-underline" underline animation.
 *   RIGHT: ConnectionPill + SettingsPopup gear icon.
 *
 * Tab switching only swaps panels. The SSE connection lives in DashboardClient
 * and is never remounted when tabs change.
 *
 * Slots for future agents:
 *   - The "monitoring" tab panel is an empty shell (filled in T53).
 *   - Model badge lives inside the Dashboard tab panel in DashboardClient.
 */
import { motion, useReducedMotion } from "framer-motion";
import { BarChart2, FlaskConical, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDashboard } from "@/context/DashboardContext";
import { SettingsPopup } from "./SettingsPopup";

export type NavTab = "dashboard" | "training-lab" | "monitoring";

export const NAV_TABS: { id: NavTab; label: string; icon: React.ReactNode }[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: <BarChart2 className="size-3.5" aria-hidden="true" />,
  },
  {
    id: "training-lab",
    label: "Training Lab",
    icon: <FlaskConical className="size-3.5" aria-hidden="true" />,
  },
  {
    id: "monitoring",
    label: "Monitoring",
    icon: <Activity className="size-3.5" aria-hidden="true" />,
  },
];

interface TopNavProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
}

export function TopNav({ activeTab, onTabChange }: TopNavProps) {
  const { datasetMeta } = useDashboard();
  const accent = datasetMeta?.theme.accent ?? "#64748b";
  const reduceMotion = useReducedMotion();

  return (
    <header
      className="flex items-center justify-between border-b border-border bg-white/80 backdrop-blur-sm sticky top-0 z-20 px-4"
      role="banner"
    >
      {/* Skip link for keyboard users (WCAG 2.4.1) */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-xs focus:font-medium focus:text-foreground focus:shadow-md focus:ring-2 focus:ring-ring/50"
      >
        Skip to content
      </a>

      {/* LEFT: tab links */}
      <div className="flex items-center">
        {/* Tab links */}
        <nav
          aria-label="Dashboard sections"
          role="tablist"
          className="flex items-center gap-0.5"
        >
          {NAV_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                aria-controls={`tab-panel-${tab.id}`}
                id={`tab-${tab.id}`}
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  "relative flex items-center gap-1.5 px-3 py-3 text-xs font-medium transition-colors outline-none",
                  "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {tab.icon}
                {tab.label}
                {/* Animated underline — shared layoutId across all tabs */}
                {isActive && (
                  <motion.span
                    layoutId={reduceMotion ? undefined : "tab-underline"}
                    transition={reduceMotion ? { duration: 0 } : undefined}
                    className="absolute inset-x-0 bottom-0 h-0.5 rounded-t-full"
                    style={{ backgroundColor: accent }}
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* RIGHT: settings gear */}
      <div className="flex items-center gap-2">
        <SettingsPopup />
      </div>
    </header>
  );
}
