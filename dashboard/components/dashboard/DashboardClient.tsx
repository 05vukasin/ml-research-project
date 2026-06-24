"use client";

/**
 * DashboardClient — T20 (extended T26, T28, T39, T47, T48)
 *
 * Top-level client shell:
 *  - Single TopNav bar (tabs + settings/pill). Replaces the old DashboardHeader.
 *  - Tabs: Dashboard | Training Lab | Monitoring (T53 fills Monitoring content).
 *  - Tab switching swaps panels only — SSE connection never remounts.
 *  - Consumes useLiveStream; distributes aggregates/events to children.
 *  - Polls /health every 5s to keep active_dataset/model in sync.
 *  - Active-model badge rendered inside the Dashboard panel (not in the nav).
 *
 * HANDOFF NOTES for future agents:
 *  - Monitoring panel: mount your bento/grid inside the `key="monitoring"` motion.div below.
 *  - Model cards: render inside the Dashboard panel after KpiCards (slot marked below).
 *  - Benchmark surface: render inside the Dashboard panel after MetricsCharts (slot marked below).
 */
import { useEffect, useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLiveStream } from "@/hooks/useLiveStream";
import { useDashboard } from "@/context/DashboardContext";
import { fetchHealth } from "@/lib/api";
import { TopNav, type NavTab } from "./TopNav";
import { AccuracyGauge } from "./AccuracyGauge";
import { LiveFeed } from "./LiveFeed";
import { PipelineFlow } from "./PipelineFlow";
import { KpiCards } from "./KpiCards";
import { MetricsCharts } from "./MetricsCharts";
import { ProgressWidget } from "./ProgressWidget";
import { TrainingLab } from "./TrainingLab";
import { ModelCards } from "./ModelCards";
import { BenchmarkSurface } from "./BenchmarkSurface";
import { Monitoring } from "./Monitoring";
import { Badge } from "@/components/ui/badge";
import type { PendingTrainingJob } from "@/lib/types";

const HEALTH_POLL_MS = 5_000;

export function DashboardClient() {
  const { aggregates, events } = useLiveStream();
  const { setActive, activeDataset, datasetMeta, modelMeta } = useDashboard();
  const [activeTab, setActiveTab] = useState<NavTab>("dashboard");
  // Bumped after training completes to trigger ModelCards refresh
  const [modelCatalogKey, setModelCatalogKey] = useState(0);
  // In-flight training job → drives the live loading card in the model catalog
  const [pendingJob, setPendingJob] = useState<PendingTrainingJob | null>(null);

  // Sync active dataset/model from health
  const syncHealth = useCallback(async () => {
    try {
      const h = await fetchHealth();
      if (h.active_dataset && h.active_model) {
        setActive(h.active_dataset, h.active_model);
      }
    } catch {
      // Silently ignore — SSE is the primary data source
    }
  }, [setActive]);

  useEffect(() => {
    syncHealth();
    const id = setInterval(syncHealth, HEALTH_POLL_MS);
    return () => clearInterval(id);
  }, [syncHealth]);

  // Resolve in-flight count as events in last 500ms
  const inFlightCount = events.filter((e) => {
    const age = Date.now() - new Date(e.ts).getTime();
    return age < 500;
  }).length;

  return (
    <div className="flex flex-col h-full min-h-screen bg-slate-50/50">
      {/* Single slim nav bar — tabs left, settings+pill right */}
      <TopNav activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Tab panels */}
      <main id="main-content" className="flex-1 p-4 md:p-6 overflow-auto">
        <div className="max-w-screen-xl mx-auto">
          <AnimatePresence mode="wait" initial={false}>

            {activeTab === "dashboard" && (
              <motion.div
                key="dashboard"
                role="tabpanel"
                id="tab-panel-dashboard"
                aria-labelledby="tab-dashboard"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="flex flex-col gap-6"
              >
                {/* Active model badge — replaces header center slot (T47) */}
                {(datasetMeta || modelMeta) && (
                  <div className="flex items-center gap-2">
                    {datasetMeta && (
                      <Badge variant="outline" className="text-xs font-medium">
                        {datasetMeta.label}
                      </Badge>
                    )}
                    {modelMeta && (
                      <span className="text-xs text-muted-foreground">
                        {modelMeta.name}
                      </span>
                    )}
                    {!datasetMeta && (
                      <span className="text-xs text-muted-foreground">
                        {activeDataset || "—"}
                      </span>
                    )}
                  </div>
                )}

                {/* Hero row: Gauge (center/largest) + Live Feed (right) */}
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
                  {/* Left column: Gauge + Pipeline */}
                  <div className="flex flex-col gap-6">
                    {/* Hero gauge — visually dominant */}
                    <div className="flex justify-center">
                      <div className="w-full max-w-[340px]">
                        <AccuracyGauge
                          accuracy={aggregates.running_accuracy}
                          totalProcessed={aggregates.total_processed}
                          dataset={aggregates.dataset || activeDataset}
                        />
                      </div>
                    </div>

                    {/* Pipeline flow */}
                    <PipelineFlow
                      throughput={aggregates.throughput}
                      inFlightCount={inFlightCount}
                    />
                  </div>

                  {/* Right column: Live Feed (fixed h-[420px]) + Progress widget */}
                  <div className="flex flex-col gap-4">
                    {/* LiveFeed has its own fixed height (h-[420px]) — no min-h wrapper */}
                    <LiveFeed events={events} />
                    {/* Progress widget — secondary to hero gauge */}
                    <ProgressWidget />
                  </div>
                </div>

                {/* KPI cards */}
                <KpiCards aggregates={aggregates} />

                {/* Charts */}
                <MetricsCharts aggregates={aggregates} />

                {/* Benchmark surface — active model current/last run (T52) */}
                <BenchmarkSurface />
              </motion.div>
            )}

            {activeTab === "training-lab" && (
              <motion.div
                key="training-lab"
                role="tabpanel"
                id="tab-panel-training-lab"
                aria-labelledby="tab-training-lab"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                <div className="mb-6">
                  <h2 className="text-base font-semibold text-foreground">Training Lab</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Train a new model and watch accuracy climb live.
                    The model registers automatically and can be activated in Settings.
                  </p>
                </div>
                <TrainingLab
                  onModelsTrained={() => setModelCatalogKey((k) => k + 1)}
                  onJobChange={setPendingJob}
                />
                {/* Model catalog cards (T51) — refresh key bumped after training */}
                <div className="mt-8">
                  <ModelCards refreshKey={modelCatalogKey} pendingJob={pendingJob} />
                </div>
              </motion.div>
            )}

            {activeTab === "monitoring" && (
              <motion.div
                key="monitoring"
                role="tabpanel"
                id="tab-panel-monitoring"
                aria-labelledby="tab-monitoring"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="flex flex-col gap-6"
              >
                <Monitoring />
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
