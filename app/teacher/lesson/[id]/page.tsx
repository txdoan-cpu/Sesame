import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { ActionForm } from "@/app/_components/ActionForm";
import { cardClass, fill, inputClass } from "@/app/_components/styles";
import { RUBRIC_S } from "@/lib/generation/pedagogy";
import { LessonSchema } from "@/lib/lesson/schema";
import { getGeneratedLesson, getLessonReviews } from "@/lib/teacher/lessons";
import en from "@/messages/en.json";
import { reviewLesson } from "../../actions";
import { StatusBadge, lessonTone } from "../../StatusBadge";

export const metadata: Metadata = { title: "Generated lesson — Sesame" };
// Lesson generation and AI scoring can take a minute or more on Vercel (§7.9).
export const maxDuration = 300;

const t = en.teacher;
const g = en.teacher.gen;

const Citation = z.object({ id: z.string(), text: z.string() });
const Rationale = z
  .object({
    pace: z.string().optional(),
    rules_applied: z.array(z.object({ id: z.string(), text: z.string() })).default([]),
    excluded: z.array(z.object({ id: z.string(), name: z.string(), why: z.string() })).default([]),
    activities: z
      .array(
        z.object({
          activity: z.enum(["activate", "present", "guided_practice", "apply", "close"]),
          methods: z.array(z.object({ id: z.string(), name: z.string(), reason: z.string(), score: z.number(), evidence: z.string(), citations: z.array(Citation) })),
          alternatives: z.array(z.object({ id: z.string(), name: z.string(), score: z.number() })),
        }),
      )
      .default([]),
    review_after_days: z.array(z.number()).nullable().optional(),
    sources: z.array(z.object({ id: z.string(), title: z.string(), source_url: z.string().nullable(), licence: z.string() })).default([]),
    attempts: z
      .array(z.object({ attempt: z.number(), total: z.number().nullable(), failedGates: z.array(z.string()), math: z.array(z.object({ where: z.string(), detail: z.string() })), error: z.string().optional() }))
      .default([]),
  })
  .catch({ rules_applied: [], excluded: [], activities: [], sources: [], attempts: [] });
const Critic = z
  .object({ scores: z.record(z.string(), z.number()), reasons: z.record(z.string(), z.string()).default({}), total: z.number(), failedGates: z.array(z.string()), summary: z.string().default("") })
  .nullable()
  .catch(null);

export default function GeneratedLessonPage({ params }: PageProps<"/teacher/lesson/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <Suspense fallback={<p>{en.app.loading}</p>}>
        <Detail params={params} />
      </Suspense>
    </main>
  );
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = /^gen-[a-z0-9-]{8,60}$/.test(id) ? await getGeneratedLesson(id) : null;
  if (!row) notFound();
  const reviews = await getLessonReviews(id);
  const r = Rationale.parse(row.rationale);
  const critic = Critic.parse(row.rubric_s ?? null);
  const lesson = LessonSchema.safeParse(row.lesson).data ?? null;

  return (
    <>
      <Link href="/teacher/lessons" className="inline-flex min-h-11 items-center self-start font-medium underline">
        ← {g.detailBack}
      </Link>
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">{lesson?.title ?? row.outcome_code}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono font-semibold">{row.outcome_code}</span>
          <span>· {row.pseudonym}</span>
          <span data-testid="lesson-status">
            <StatusBadge status={lessonTone(row.status)} label={g.status[row.status]} />
          </span>
          {row.fit_score !== null && <span data-testid="fit-score">{row.fit_score}/100</span>}
        </div>
        {row.error && <p className="rounded-lg bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-100">{row.error}</p>}
      </header>

      <section aria-labelledby="profile-title" className={cardClass}>
        <h2 id="profile-title" className="text-xl font-semibold">
          {g.profileTitle}
        </h2>
        <pre className="whitespace-pre-wrap text-sm" data-testid="profile-used">
          {JSON.stringify(row.profile_used, null, 2)}
        </pre>
      </section>

      <section aria-labelledby="rationale-title" className={cardClass} data-testid="rationale-card">
        <h2 id="rationale-title" className="text-xl font-semibold">
          {g.rationaleTitle}
        </h2>
        {r.rules_applied.length > 0 && (
          <div>
            <h3 className="font-semibold">{g.rulesApplied}</h3>
            <ul className="list-disc pl-6">
              {r.rules_applied.map((x) => (
                <li key={x.id}>
                  <strong>{x.id}</strong> {x.text}
                </li>
              ))}
            </ul>
          </div>
        )}
        <ol className="flex flex-col gap-3">
          {r.activities.map((a) => (
            <li key={a.activity} className="rounded-lg border border-zinc-300 p-3 dark:border-zinc-700" data-testid={`plan-${a.activity}`}>
              <p className="font-semibold">{g.activity[a.activity]}</p>
              {a.methods.map((m) => (
                <div key={m.id} className="mt-1">
                  <p>
                    <strong>{m.name}</strong> ({fill(g.methodScore, { score: m.score })}, evidence {m.evidence})
                  </p>
                  <p className="text-sm">{m.reason}</p>
                  {m.citations.length > 0 && (
                    <details>
                      <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">{g.citations}</summary>
                      <ul className="list-disc pl-6 text-sm" data-testid="citations">
                        {m.citations.map((c) => (
                          <li key={c.id}>{c.text}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              ))}
              {a.alternatives.length > 0 && (
                <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                  {g.alternatives}: {a.alternatives.map((x) => `${x.name} (${x.score})`).join(", ")}
                </p>
              )}
            </li>
          ))}
        </ol>
        {r.excluded.length > 0 && (
          <details>
            <summary className="min-h-11 cursor-pointer py-2 font-medium">{g.excluded}</summary>
            <ul className="list-disc pl-6 text-sm">
              {r.excluded.map((x) => (
                <li key={x.id}>
                  {x.name}: {x.why}
                </li>
              ))}
            </ul>
          </details>
        )}
        {r.review_after_days && <p className="text-sm">{fill(g.spaced, { days: r.review_after_days.join(", ") })}</p>}
        {r.sources.length > 0 && (
          <div data-testid="sources">
            <h3 className="font-semibold">{g.sourcesTitle}</h3>
            <ul className="list-disc pl-6">
              {r.sources.map((s) => (
                <li key={s.id}>
                  {s.source_url ? (
                    <a href={s.source_url} className="underline" rel="noreferrer" target="_blank">
                      {s.title}
                    </a>
                  ) : (
                    s.title
                  )}{" "}
                  · {t.licences[s.licence as keyof typeof t.licences] ?? s.licence}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section aria-labelledby="rubric-s-title" className="flex flex-col gap-3">
        <h2 id="rubric-s-title" className="text-xl font-semibold">
          {critic ? fill(g.rubricTitle, { total: critic.total }) : g.noScore}
        </h2>
        {critic && (
          <>
            {critic.summary && <p>{critic.summary}</p>}
            {critic.failedGates.length > 0 && <p className="font-semibold text-red-800 dark:text-red-300">{fill(g.failedGates, { list: critic.failedGates.join(", ") })}</p>}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm" data-testid="rubric-s-table">
                <thead>
                  <tr className="border-b-2 border-zinc-300 dark:border-zinc-700">
                    <th className="p-2">{t.criterion}</th>
                    <th className="p-2">{t.weight}</th>
                    <th className="p-2">{t.score}</th>
                    <th className="p-2">{t.reason}</th>
                  </tr>
                </thead>
                <tbody>
                  {RUBRIC_S.criteria.map((c) => (
                    <tr key={c.id} className="border-b border-zinc-200 align-top dark:border-zinc-800" data-testid={`rubric-${c.id}`}>
                      <td className="p-2">
                        <span className="font-mono font-semibold">{c.id}</span> {c.name}
                        {c.gate && <span className="ml-1 rounded bg-zinc-200 px-1 text-xs font-semibold dark:bg-zinc-800">{t.gate}</span>}
                      </td>
                      <td className="p-2">{c.weight}%</td>
                      <td className={`p-2 font-semibold ${c.gate && (critic.scores[c.id] ?? 0) < RUBRIC_S.gate_min ? "text-red-800 dark:text-red-300" : ""}`}>{critic.scores[c.id] ?? 0} / 3</td>
                      <td className="p-2">{critic.reasons[c.id]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {r.attempts.length > 0 && (
          <details>
            <summary className="min-h-11 cursor-pointer py-2 font-medium">{g.attemptsTitle}</summary>
            <ul className="list-disc pl-6 text-sm" data-testid="attempts">
              {r.attempts.map((a) => (
                <li key={a.attempt}>
                  {fill(g.attemptLine, { n: a.attempt, total: a.total === null ? (a.error ?? "-") : `${a.total}/100` })}
                  {a.math.length > 0 && ` · ${g.mathProblems}: ${a.math.map((m) => `${m.where}: ${m.detail}`).join("; ")}`}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {lesson && (
        <section aria-labelledby="slides-title" className="flex flex-col gap-3">
          <h2 id="slides-title" className="text-xl font-semibold">
            {g.slidesTitle}
          </h2>
          <ol className="flex flex-col gap-3" data-testid="slide-preview">
            {lesson.slides.map((s) => (
              <li key={s.no} className={cardClass}>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">
                  {s.no}. {s.activity ? g.activity[s.activity] : ""} · {s.method} · {s.indicators.join(", ")}
                </p>
                <p className="font-semibold">{s.title}</p>
                <p className="whitespace-pre-wrap">{s.body_md}</p>
                <p className="text-sm italic">{s.narration}</p>
                {s.visual.type === "steps" && <pre className="text-sm">{s.visual.lines.join("\n")}</pre>}
                {s.visual.type === "compare" && (
                  <pre className="text-sm">{s.visual.people.map((p) => `${p.name}: ${p.lines.join(" → ")}`).join("\n")}</pre>
                )}
                {s.visual.type === "balance" && <pre className="text-sm">{`${s.visual.left} = ${s.visual.right}`}</pre>}
                {(s.checkpoint?.items ?? []).map((i) => (
                  <p key={i.id} className="text-sm">
                    • {i.prompt}{" "}
                    {i.kind === "numeric" ? `(${g.answer}: ${i.answer})` : `(${g.answer}: ${i.options.find((o) => o.correct)?.text ?? ""})`}
                  </p>
                ))}
              </li>
            ))}
          </ol>
          <div className={cardClass}>
            <p className="font-semibold">{g.exitTitle}</p>
            {lesson.exit_ticket.choice.map((c) => (
              <p key={c.id} className="text-sm">
                • {c.prompt} ({g.answer}: {c.options.find((o) => o.correct)?.text})
              </p>
            ))}
          </div>
        </section>
      )}

      {row.status !== "generating" && row.status !== "failed" && (
        <section aria-labelledby="review-title" className={cardClass}>
          <h2 id="review-title" className="text-xl font-semibold">
            {g.reviewTitle}
          </h2>
          <ActionForm action={reviewLesson} submitLabel={g.submitReview} pendingLabel={g.generating} errors={t.errors} success={g.reviewed} testId="review-form">
            <input type="hidden" name="id" value={row.id} />
            <label className="flex flex-col gap-1">
              {g.decision}
              <select name="decision" defaultValue={row.status === "review" ? "revise" : "approve"} className={inputClass}>
                <option value="approve">{g.decisions.approve}</option>
                <option value="revise">{g.decisions.revise}</option>
                <option value="reject">{g.decisions.reject}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              {g.notes}
              <textarea name="notes" rows={3} maxLength={2000} className={`${inputClass} py-2`} />
            </label>
          </ActionForm>
          {reviews.length > 0 && (
            <div>
              <h3 className="font-semibold">{g.history}</h3>
              <ul className="list-disc pl-6 text-sm" data-testid="review-history">
                {reviews.map((v) => (
                  <li key={v.id}>
                    {v.created_at.slice(0, 10)} · {v.decision}
                    {v.notes ? `: ${v.notes}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </>
  );
}
