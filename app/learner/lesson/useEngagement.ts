"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { HEARTBEAT_MS, isActive, shouldPauseForCheckpoint } from "@/lib/engagement";
import type { SessionStartResponse } from "@/app/api/session/route";

/**
 * Tracks real study time in the browser (§7.5) and reports it to /api/session.
 * Uses only clicks/taps/keys, tab visibility and whether narration is playing:
 * no camera, no microphone.
 */

type EventType = "checkpoint_answer" | "question" | "idle_start" | "idle_end" | "tab_hidden" | "tab_visible" | "resume" | "paused";
type QueuedEvent = { type: EventType; payload: Record<string, string | number | boolean | null> };

type Options = {
  enabled: boolean;
  lessonId: string;
  slideNo: number;
  /** A check-in on this slide is still open. */
  checkpointOpen: boolean;
  narrationSpeakingRef: RefObject<boolean>;
  narrationStartedAtRef: RefObject<number | null>;
  /** Called once when the lesson pauses for "Are you still there?". */
  onPause: () => void;
};

function post(body: unknown): Promise<Response> {
  return fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive: true });
}

export function useEngagement({ enabled, lessonId, slideNo, checkpointOpen, narrationSpeakingRef, narrationStartedAtRef, onPause }: Options) {
  const [paused, setPaused] = useState(false);
  const sessionId = useRef<string | null>(null);
  // Set when tracking starts (the lesson's Start button is the first interaction).
  const lastInteraction = useRef(0);
  const visible = useRef(true);
  const counters = useRef({ active: 0, idle: 0, away: 0, wasActive: true });
  const queue = useRef<QueuedEvent[]>([]);
  const pausedRef = useRef(false);
  // Latest values for the interval callbacks.
  const live = useRef({ slideNo, checkpointOpen, onPause });
  useEffect(() => {
    live.current = { slideNo, checkpointOpen, onPause };
  }, [slideNo, checkpointOpen, onPause]);

  const record = useCallback((type: EventType, payload: QueuedEvent["payload"] = {}) => {
    queue.current.push({ type, payload: { slide_no: live.current.slideNo, ...payload } });
  }, []);

  // Start the session once (the ref survives React's dev double-run of effects,
  // so we never create a second, orphaned session).
  const starting = useRef(false);
  useEffect(() => {
    if (!enabled || starting.current) return;
    starting.current = true;
    lastInteraction.current = Date.now();
    void post({ action: "start", lessonId })
      .then((r) => r.json() as Promise<SessionStartResponse>)
      .then((r) => {
        if (r.ok) sessionId.current = r.sessionId;
      })
      .catch(() => {
        starting.current = false;
      });
  }, [enabled, lessonId]);

  // Interactions and tab visibility.
  useEffect(() => {
    if (!enabled) return;
    const touch = () => {
      lastInteraction.current = Date.now();
    };
    const onVisibility = () => {
      visible.current = document.visibilityState === "visible";
      record(visible.current ? "tab_visible" : "tab_hidden");
      if (visible.current) touch();
    };
    const events = ["pointerdown", "keydown", "touchstart", "wheel"] as const;
    for (const e of events) window.addEventListener(e, touch, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      for (const e of events) window.removeEventListener(e, touch);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, record]);

  // Once a second: count active/idle time, and pause on an unanswered check-in.
  useEffect(() => {
    if (!enabled) return;
    const tick = setInterval(() => {
      const now = Date.now();
      const active = isActive({
        now,
        tabVisible: visible.current,
        lastInteractionAt: lastInteraction.current,
        narrationPlaying: narrationSpeakingRef.current,
        narrationStartedAt: narrationStartedAtRef.current,
      });
      const c = counters.current;
      if (active) {
        c.active++;
        c.away = 0;
      } else {
        c.idle++;
        c.away++;
      }
      if (active !== c.wasActive) record(active ? "idle_end" : "idle_start");
      c.wasActive = active;

      if (
        shouldPauseForCheckpoint({
          now,
          checkpointOpen: live.current.checkpointOpen,
          lastInteractionAt: lastInteraction.current,
          narrationPlaying: narrationSpeakingRef.current,
          paused: pausedRef.current,
        })
      ) {
        pausedRef.current = true;
        setPaused(true);
        record("paused");
        live.current.onPause();
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [enabled, record, narrationSpeakingRef, narrationStartedAtRef]);

  // Report to the server every 15 seconds.
  useEffect(() => {
    if (!enabled) return;
    const beat = setInterval(() => {
      if (!sessionId.current) return;
      const c = counters.current;
      const body = {
        action: "heartbeat",
        sessionId: sessionId.current,
        activeDelta: c.active,
        idleDelta: c.idle,
        slideNo: live.current.slideNo,
        awaySeconds: c.away,
        paused: pausedRef.current,
        events: queue.current.splice(0, 50),
      };
      c.active = 0;
      c.idle = 0;
      void post(body).catch(() => {});
    }, HEARTBEAT_MS);
    return () => clearInterval(beat);
  }, [enabled]);

  // End the session when the page goes away.
  useEffect(() => {
    if (!enabled) return;
    const end = () => {
      if (!sessionId.current) return;
      navigator.sendBeacon("/api/session", JSON.stringify({ action: "end", sessionId: sessionId.current }));
    };
    window.addEventListener("pagehide", end);
    return () => {
      window.removeEventListener("pagehide", end);
      end();
    };
  }, [enabled]);

  const resume = useCallback(() => {
    lastInteraction.current = Date.now();
    counters.current.away = 0;
    pausedRef.current = false;
    setPaused(false);
    record("resume");
  }, [record]);

  /** Mark the session finished (after the exit ticket). */
  const finish = useCallback(() => {
    if (!sessionId.current) return;
    const id = sessionId.current;
    void post({
      action: "heartbeat",
      sessionId: id,
      activeDelta: counters.current.active,
      idleDelta: counters.current.idle,
      slideNo: live.current.slideNo,
      awaySeconds: 0,
      events: queue.current.splice(0, 50),
    })
      .then(() => post({ action: "end", sessionId: id }))
      .catch(() => {});
    sessionId.current = null;
  }, []);

  return { paused, resume, record, finish };
}
