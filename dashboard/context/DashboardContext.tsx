"use client";

/**
 * DashboardContext — shared client state for active dataset/model.
 * The next agent wires the settings popup + dataset switcher here.
 * Consumed by: header, gauge (accent color), feed, charts, pipeline.
 */
import React, { createContext, useContext, useState, useCallback } from "react";
import type { Registry, RegistryDataset, RegistryModel } from "@/lib/types";
import { postControl } from "@/lib/api";

interface DashboardContextValue {
  /** Full registry from /registry */
  registry: Registry;
  /** Currently active dataset slug */
  activeDataset: string;
  /** Currently active model slug */
  activeModel: string;
  /** Convenience: active dataset metadata */
  datasetMeta: RegistryDataset | null;
  /** Convenience: active model metadata */
  modelMeta: RegistryModel | null;
  /** Called by settings popup (next agent) to switch dataset/model */
  switchDataset: (dataset: string, model?: string) => Promise<void>;
  /** Update registry after a new model is registered (training lab) */
  setRegistry: (r: Registry) => void;
  /** Update active dataset/model from health poll */
  setActive: (dataset: string, model: string) => void;
  /**
   * Shared stream paused state — single source of truth for LiveFeed button
   * and the SettingsPopup pause toggle. Toggling either updates this value.
   */
  paused: boolean;
  /** Toggle or set paused state; also fires POST /control */
  setPaused: (next: boolean) => Promise<void>;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function DashboardProvider({
  children,
  initialRegistry,
  initialDataset,
  initialModel,
}: {
  children: React.ReactNode;
  initialRegistry: Registry;
  initialDataset: string;
  initialModel: string;
}) {
  const [registry, setRegistry] = useState<Registry>(initialRegistry);
  const [activeDataset, setActiveDataset] = useState(initialDataset);
  const [activeModel, setActiveModel] = useState(initialModel);
  const [pausedState, setPausedState] = useState(false);

  const datasetMeta = registry[activeDataset] ?? null;
  const modelMeta =
    datasetMeta?.models.find((m) => m.slug === activeModel) ??
    datasetMeta?.models[0] ??
    null;

  const setActive = useCallback((dataset: string, model: string) => {
    setActiveDataset(dataset);
    setActiveModel(model);
  }, []);

  const switchDataset = useCallback(
    async (dataset: string, model?: string) => {
      const targetModel =
        model ?? registry[dataset]?.models[0]?.slug ?? "";
      await postControl({ dataset, model: targetModel });
      setActiveDataset(dataset);
      setActiveModel(targetModel);
    },
    [registry]
  );

  const setPaused = useCallback(async (next: boolean) => {
    setPausedState(next);
    try {
      await postControl({ paused: next });
    } catch {
      // Revert on failure
      setPausedState((prev) => !prev);
    }
  }, []);

  return (
    <DashboardContext.Provider
      value={{
        registry,
        activeDataset,
        activeModel,
        datasetMeta,
        modelMeta,
        switchDataset,
        setRegistry,
        setActive,
        paused: pausedState,
        setPaused,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard must be used inside DashboardProvider");
  return ctx;
}
