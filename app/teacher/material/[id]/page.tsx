import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { ActionForm } from "@/app/_components/ActionForm";
import { cardClass, fill, inputClass, secondaryButtonClass } from "@/app/_components/styles";
import { requireStaff } from "@/lib/auth/dal";
import { RUBRIC_R } from "@/lib/materials/rubric";
import { getMaterial } from "@/lib/teacher/data";
import en from "@/messages/en.json";
import { overrideMaterial, rescoreMaterial } from "../../actions";
import { StatusBadge } from "../../StatusBadge";

export const metadata: Metadata = { title: "Material review — Sesame" };

const t = en.teacher;

/** What review.ts stores in materials.rubric_r (parsed loosely: older rows may lack fields). */
const Stored = z
  .object({
    scores: z.record(z.string(), z.number()).optional(),
    reasons: z.record(z.string(), z.string()).optional(),
    summary: z.string().optional(),
    weightedMean: z.number().optional(),
    percent: z.number().optional(),
    failedGates: z.array(z.string()).optional(),
    rejectReasons: z.array(z.string()).optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    scoredAt: z.string().optional(),
    note: z.string().nullable().optional(),
    error: z.string().optional(),
    override: z.object({ decision: z.string(), reason: z.string(), at: z.string() }).optional(),
  })
  .catch({});

export default function MaterialPage({ params }: PageProps<"/teacher/material/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8">
      <Suspense fallback={<p>{en.app.loading}</p>}>
        <Material params={params} />
      </Suspense>
    </main>
  );
}

async function Material({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaff();
  const m = z.uuid().safeParse(id).success ? await getMaterial(id) : null;
  if (!m) notFound();
  const r = Stored.parse(m.rubric_r ?? {});
  const canOverride = m.uploaded_by === user.id || user.role === "admin";

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link href={`/teacher/pack/${m.curriculum_id}`} className="inline-flex min-h-11 items-center self-start font-medium underline">
          ← {t.back}
        </Link>
        <h1 className="text-3xl font-bold">{m.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span data-testid="material-status">
            <StatusBadge status={m.status} label={t.materialStatus[m.status]} />
          </span>
          <span>
            {m.outcome_codes.join(", ")} · {t.licences[m.licence as keyof typeof t.licences] ?? m.licence}
          </span>
        </div>
        {m.licence_note && <p className="text-sm">{m.licence_note}</p>}
        {m.source_url && (
          <a href={m.source_url} className="self-start break-all underline" rel="noreferrer" target="_blank">
            {m.source_url}
          </a>
        )}
      </header>

      <section aria-labelledby="rubric-title" className="flex flex-col gap-3">
        <h2 id="rubric-title" className="text-2xl font-semibold">
          {t.rubricTitle}
        </h2>
        {r.error && <p className="rounded-lg bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-100">{r.error}</p>}
        {r.note && <p className="text-sm">{fill(t.extractionNote, { note: r.note })}</p>}
        {!r.scores ? (
          <p>{t.notScored}</p>
        ) : (
          <>
            <p className="text-lg font-semibold" data-testid="rubric-mean">
              {fill(t.weightedMean, { mean: (r.weightedMean ?? 0).toFixed(2), percent: r.percent ?? 0 })}
            </p>
            {r.summary && <p>{r.summary}</p>}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm" data-testid="rubric-table">
                <thead>
                  <tr className="border-b-2 border-zinc-300 dark:border-zinc-700">
                    <th className="p-2">{t.criterion}</th>
                    <th className="p-2">{t.weight}</th>
                    <th className="p-2">{t.score}</th>
                    <th className="p-2">{t.reason}</th>
                  </tr>
                </thead>
                <tbody>
                  {RUBRIC_R.criteria.map((c) => {
                    const s = r.scores?.[c.id] ?? 0;
                    const failed = c.gate && s < RUBRIC_R.gate_min;
                    return (
                      <tr key={c.id} className="border-b border-zinc-200 align-top dark:border-zinc-800" data-testid={`rubric-${c.id}`}>
                        <td className="p-2">
                          <span className="font-mono font-semibold">{c.id}</span> {c.name}
                          {c.gate && <span className="ml-1 rounded bg-zinc-200 px-1 text-xs font-semibold dark:bg-zinc-800">{t.gate}</span>}
                        </td>
                        <td className="p-2">{c.weight}%</td>
                        <td className={`p-2 font-semibold ${failed ? "text-red-800 dark:text-red-300" : ""}`}>{s} / 3</td>
                        <td className="p-2">{r.reasons?.[c.id]}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {(r.failedGates?.length ?? 0) > 0 && (
              <p className="font-semibold text-red-800 dark:text-red-300">{fill(t.failedGates, { list: r.failedGates!.join(", ") })}</p>
            )}
            {(r.rejectReasons?.length ?? 0) > 0 && (
              <div data-testid="reject-reasons">
                <h3 className="font-semibold">{t.rejectReasons}</h3>
                <ul className="list-disc pl-6">
                  {r.rejectReasons!.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            )}
            {r.provider && (
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                {fill(t.scoredBy, { provider: r.provider, model: r.model ?? "", date: (r.scoredAt ?? "").slice(0, 10) })}
              </p>
            )}
          </>
        )}
        {r.override && (
          <p className="rounded-lg bg-blue-50 p-3 text-blue-900 dark:bg-blue-950 dark:text-blue-100" data-testid="override-note">
            {fill(t.overrideNote, { reason: r.override.reason })}
          </p>
        )}
        <form action={rescoreMaterial}>
          <input type="hidden" name="id" value={m.id} />
          <button type="submit" className={secondaryButtonClass}>
            {t.rescore}
          </button>
        </form>
      </section>

      {canOverride && (
        <section aria-labelledby="override-title" className={cardClass}>
          <h2 id="override-title" className="text-2xl font-semibold">
            {t.overrideTitle}
          </h2>
          <p>{t.overrideIntro}</p>
          <ActionForm
            action={overrideMaterial}
            submitLabel={t.saveOverride}
            pendingLabel={en.auth.pending}
            errors={t.errors}
            success={t.overridden}
            testId="override-form"
          >
            <input type="hidden" name="id" value={m.id} />
            <label className="flex flex-col gap-1">
              {t.decision}
              <select name="decision" defaultValue={m.status === "approved" ? "rejected" : "approved"} className={inputClass}>
                <option value="approved">{t.materialStatus.approved}</option>
                <option value="rejected">{t.materialStatus.rejected}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              {t.overrideReason}
              <textarea name="reason" required minLength={10} maxLength={1000} rows={3} className={`${inputClass} py-2`} />
            </label>
          </ActionForm>
        </section>
      )}

      {m.extracted_text && (
        <section aria-labelledby="text-title" className="flex flex-col gap-2">
          <h2 id="text-title" className="text-xl font-semibold">
            {t.textPreview}
          </h2>
          <pre className="whitespace-pre-wrap rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-900">{m.extracted_text.slice(0, 600)}</pre>
        </section>
      )}
    </>
  );
}
