"use client";

import Link from "next/link";
import { useState } from "react";
import type { ExitView } from "@/lib/lesson/view";
import { learnerMessages } from "@/lib/i18n";
import { ExitTicket } from "../lesson/ExitTicket";

const t = learnerMessages.check;

/**
 * Keeps the memory check (and its results) on screen after submitting.
 * Submitting refreshes the page on the server, where the check is no longer
 * "ready"; this component stays mounted, so the learner still sees results.
 */
export function CheckClient({ ready, outcome, lessonId, exit }: { ready: boolean; outcome: string | null; lessonId: string | null; exit: ExitView | null }) {
  const [started, setStarted] = useState(ready);
  // The check as first shown; after the refresh the server no longer sends it.
  const [check] = useState({ outcome, lessonId, exit });
  if (!started || !check.lessonId || !check.exit) {
    return (
      <>
        <p className="text-lg">{t.notReady}</p>
        <Link href="/learner" className="inline-flex min-h-11 items-center font-medium underline">
          {learnerMessages.lesson.backHome}
        </Link>
      </>
    );
  }
  return (
    <>
      <p className="text-lg">{t.intro.replace("{outcome}", check.outcome ?? "")}</p>
      <ExitTicket lessonId={check.lessonId} exit={check.exit} kind="retention" title={t.formTitle} onFinished={() => setStarted(true)} />
    </>
  );
}
