"use client";

import { useCallback, useEffect, useState } from "react";
import { HealthResultSchema, type HealthResult } from "@/lib/llm/types";
import en from "@/messages/en.json";

const t = en.health;

type State = { status: "loading" } | { status: "done"; result: HealthResult } | { status: "failed" };

export function HealthStatus() {
  const [state, setState] = useState<State>({ status: "loading" });

  const check = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/health/claude", { cache: "no-store" });
      const parsed = HealthResultSchema.safeParse(await res.json());
      setState(parsed.success ? { status: "done", result: parsed.data } : { status: "failed" });
    } catch {
      setState({ status: "failed" });
    }
  }, []);

  useEffect(() => {
    // Fetch once on mount; the async setState happens after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void check();
  }, [check]);

  return (
    <section aria-live="polite" className="flex flex-col gap-4">
      {state.status === "loading" && <p className="text-lg">{t.checking}</p>}

      {state.status === "failed" && (
        <StatusCard tone="error" title={t.notConnected}>
          <p>Could not read the health check response from the server.</p>
        </StatusCard>
      )}

      {state.status === "done" && state.result.ok && (
        <StatusCard tone="ok" title={t.connected}>
          <Row label={t.provider} value={state.result.provider} />
          <Row label={t.model} value={state.result.model} />
          <Row label={t.reply} value={state.result.reply} testId="health-reply" />
        </StatusCard>
      )}

      {state.status === "done" && !state.result.ok && (
        <StatusCard
          tone={state.result.code === "missing_key" ? "warn" : "error"}
          title={state.result.code === "missing_key" ? t.missingKeyTitle : t.notConnected}
        >
          <Row label={t.provider} value={state.result.provider} />
          <Row label={t.model} value={state.result.model} />
          <Row label={t.error} value={state.result.error} testId="health-error" />
        </StatusCard>
      )}

      <button
        type="button"
        onClick={() => void check()}
        disabled={state.status === "loading"}
        className="min-h-11 self-start rounded-lg bg-blue-700 px-5 text-base font-medium text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-60"
      >
        {t.retry}
      </button>
    </section>
  );
}

const tones = {
  ok: "border-green-700 bg-green-50 text-green-950 dark:bg-green-950 dark:text-green-50",
  warn: "border-amber-600 bg-amber-50 text-amber-950 dark:bg-amber-950 dark:text-amber-50",
  error: "border-red-700 bg-red-50 text-red-950 dark:bg-red-950 dark:text-red-50",
} as const;

function StatusCard({
  tone,
  title,
  children,
}: {
  tone: keyof typeof tones;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border-2 p-4 ${tones[tone]}`} data-testid={`health-${tone}`}>
      <h2 className="mb-2 text-xl font-semibold">{title}</h2>
      <dl className="flex flex-col gap-1">{children}</dl>
    </div>
  );
}

function Row({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:gap-2">
      <dt className="font-medium">{label}:</dt>
      <dd data-testid={testId} className="break-words">
        {value}
      </dd>
    </div>
  );
}
