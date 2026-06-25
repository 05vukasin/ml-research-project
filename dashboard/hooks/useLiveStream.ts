"use client";

/**
 * useLiveStream — T21
 * Single EventSource to GET /stream. Buffers events in a ref and flushes to
 * state on requestAnimationFrame (~60fps). Never setState per-event.
 *
 * Returns:
 *  - aggregates: latest running totals (gauge, KPI cards)
 *  - events:     bounded recent-events list (cap=40) for the live feed
 *  - status:     connection pill state
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { streamUrl } from "@/lib/api";
import type { StreamEvent, StreamAggregates, ConnectionStatus } from "@/lib/types";

const MAX_EVENTS = 40;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

const INITIAL_AGGREGATES: StreamAggregates = {
  running_accuracy: 0,
  total_processed: 0,
  positive_count: 0,
  throughput: 0,
  avg_latency: 0,
  dataset: "",
};

export function useLiveStream() {
  const [aggregates, setAggregates] = useState<StreamAggregates>(INITIAL_AGGREGATES);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  // Buffer: new events arrive here; flushed on rAF
  const bufferRef = useRef<StreamEvent[]>([]);
  const rafRef = useRef<number | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const flush = useCallback(() => {
    rafRef.current = null;
    const pending = bufferRef.current.splice(0); // drain buffer
    if (pending.length === 0) return;

    // Latest event (incl. the on-connect snapshot) seeds the running aggregates.
    const latest = pending[pending.length - 1];
    setAggregates({
      running_accuracy: latest.running_accuracy,
      total_processed: latest.total_processed,
      positive_count: latest.positive_count,
      throughput: latest.throughput,
      avg_latency: latest.avg_latency,
      dataset: latest.dataset,
    });
    // Snapshot events only seed aggregates — they are not real predictions, so
    // keep them out of the live feed list.
    const feedEvents = pending.filter((e) => !e.snapshot);
    if (feedEvents.length === 0) return;
    setEvents((prev) => {
      const next = [...feedEvents, ...prev].slice(0, MAX_EVENTS);
      return next;
    });
  }, []);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(flush);
  }, [flush]);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    setStatus("connecting");
    const url = streamUrl();
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      if (!mountedRef.current) return;
      backoffRef.current = INITIAL_BACKOFF_MS;
      setStatus("connected");
    };

    es.onmessage = (e: MessageEvent) => {
      if (!mountedRef.current) return;
      try {
        const event: StreamEvent = JSON.parse(e.data as string);
        bufferRef.current.push(event);
        scheduleFlush();
      } catch {
        // silently drop malformed events
      }
    };

    es.onerror = () => {
      if (!mountedRef.current) return;
      es.close();
      esRef.current = null;
      setStatus("disconnected");

      // Exponential backoff reconnect
      const delay = backoffRef.current;
      backoffRef.current = Math.min(delay * 2, MAX_BACKOFF_MS);
      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current) connect();
      }, delay);
    };
  }, [scheduleFlush]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
      }
      esRef.current?.close();
      esRef.current = null;
    };
  }, [connect]);

  return { aggregates, events, status };
}
