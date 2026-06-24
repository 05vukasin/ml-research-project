/**
 * Root page — Server Component.
 * Fetches /registry and /health once at render time (initial SSR state).
 * Passes initial data to the DashboardProvider so the client starts hydrated.
 */
import { Suspense } from "react";
import { DashboardProvider } from "@/context/DashboardContext";
import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { fetchRegistry, fetchHealth } from "@/lib/api";
import type { Registry } from "@/lib/types";

// Fallback data in case backend is not yet up during build
const FALLBACK_REGISTRY: Registry = {
  fraud: {
    label: "Credit Card Fraud",
    positive_label: "Fraud",
    theme: { accent: "#ef4444" },
    models: [
      {
        name: "FraudGuard v1",
        slug: "fraudguard-v1",
        algo: "RandomForestClassifier",
        features: [],
        classes: { "0": "Legit", "1": "Fraud" },
        metrics: { accuracy: 0.934, precision: 0.975, recall: 0.333 },
        trained_at: "2026-06-23",
        formats: { joblib: null, pickle: null, onnx: null, pmml: null },
        scaler: "scaler.joblib",
      },
    ],
  },
};

async function getInitialData() {
  try {
    const [registry, health] = await Promise.all([
      fetchRegistry(),
      fetchHealth(),
    ]);
    return {
      registry,
      activeDataset: health.active_dataset ?? "fraud",
      activeModel: health.active_model ?? "fraudguard-v1",
    };
  } catch {
    // Backend may not be running during build — fall back gracefully
    return {
      registry: FALLBACK_REGISTRY,
      activeDataset: "fraud",
      activeModel: "fraudguard-v1",
    };
  }
}

export default async function HomePage() {
  const { registry, activeDataset, activeModel } = await getInitialData();

  return (
    <DashboardProvider
      initialRegistry={registry}
      initialDataset={activeDataset}
      initialModel={activeModel}
    >
      <Suspense>
        <DashboardClient />
      </Suspense>
    </DashboardProvider>
  );
}
