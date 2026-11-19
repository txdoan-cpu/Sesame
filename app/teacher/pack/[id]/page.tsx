import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/app/_components/ActionForm";
import { cardClass, inputClass, secondaryButtonClass } from "@/app/_components/styles";
import { requireStaff } from "@/lib/auth/dal";
import { getPack } from "@/lib/teacher/data";
import { BLOOM_LEVELS, KNOWLEDGE_TYPES } from "@/lib/teacher/schemas";
import en from "@/messages/en.json";
import { addStrand, approveOutcome, createOutcome, deleteOutcome } from "../../actions";
import { ImportForm } from "../../ImportForm";
import { MaterialUploadForm } from "../../MaterialUploadForm";
import { StatusBadge } from "../../StatusBadge";

export const metadata: Metadata = { title: "Curriculum pack — Sesame" };

const t = en.teacher;

export default function PackPage({ params }: PageProps<"/teacher/pack/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8">
      <Suspense fallback={<p>{en.app.loading}</p>}>
        <Pack params={params} />
      </Suspense>
    </main>
  );
}

async function Pack({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaff();
  const data = /^[0-9a-f-]{36}$/i.test(id) ? await getPack(id) : null;
  if (!data) notFound();
  const { pack, strands, outcomes, materials } = data;

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link href="/teacher" className="inline-flex min-h-11 items-center self-start font-medium underline">
          ← {t.back}
        </Link>
        <h1 className="text-3xl font-bold" data-testid="pack-title">
          {pack.province} · {t.grade} {pack.grade} · {pack.subject}
        </h1>
        <p>
          {pack.source_url ? (
            <a href={pack.source_url} className="underline" rel="noreferrer" target="_blank">
              {pack.source_title}
            </a>
          ) : (
            pack.source_title
          )}{" "}
          · {pack.published ? t.published : t.unpublished}
        </p>
      </header>

      <section aria-labelledby="outcomes-title" className="flex flex-col gap-3">
        <h2 id="outcomes-title" className="text-2xl font-semibold">
          {t.outcomesTitle}
        </h2>
        {outcomes.length === 0 ? (
          <p>{t.outcomesEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="outcome-list">
            {outcomes.map((o) => {
              const editable = o.status === "draft" && (o.created_by === user.id || user.role === "admin");
              return (
                <li key={o.code} className={cardClass} data-testid={`outcome-${o.code}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-lg font-semibold">{o.code}</span>
                    <span className="text-sm">{o.strand}</span>
                    <StatusBadge status={o.status} label={o.status === "draft" ? t.draft : t.approved} />
                  </div>
                  <p>{o.description_en}</p>
                  {(o.bloom_level || o.knowledge_type) && (
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">
                      {o.bloom_level && `${t.bloom}: ${o.bloom_level}`}
                      {o.bloom_level && o.knowledge_type && " · "}
                      {o.knowledge_type && `${t.knowledgeType}: ${o.knowledge_type}`}
                      {o.prerequisites.length > 0 && ` · ${t.prerequisites}: ${o.prerequisites.join(", ")}`}
                    </p>
                  )}
                  {o.indicators.length > 0 && (
                    <details>
                      <summary className="min-h-11 cursor-pointer py-2 font-medium">
                        {t.indicators} ({o.indicators.length})
                      </summary>
                      <ul className="list-disc pl-6">
                        {o.indicators.map((i) => (
                          <li key={i.code}>
                            <span className="font-mono">{i.code}</span> {i.description}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {o.misconceptions.length > 0 && (
                    <details>
                      <summary className="min-h-11 cursor-pointer py-2 font-medium">
                        {t.misconceptions} ({o.misconceptions.length})
                      </summary>
                      <ul className="list-disc pl-6">
                        {o.misconceptions.map((m) => (
                          <li key={m.code}>
                            <span className="font-mono">{m.code}</span> {m.description}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {editable && (
                    <div className="flex flex-wrap gap-2">
                      <form action={approveOutcome}>
                        <input type="hidden" name="code" value={o.code} />
                        <input type="hidden" name="packId" value={pack.id} />
                        <button type="submit" className={secondaryButtonClass} title={t.approveHint}>
                          {t.approve}
                        </button>
                      </form>
                      <form action={deleteOutcome}>
                        <input type="hidden" name="code" value={o.code} />
                        <input type="hidden" name="packId" value={pack.id} />
                        <button type="submit" className={secondaryButtonClass}>
                          {t.delete}
                        </button>
                      </form>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="add-outcome-title" className={cardClass}>
        <h2 id="add-outcome-title" className="text-2xl font-semibold">
          {t.addOutcomeTitle}
        </h2>
        <ActionForm
          action={createOutcome}
          submitLabel={t.addOutcome}
          pendingLabel={en.auth.pending}
          errors={t.errors}
          success={t.outcomeAdded}
          testId="add-outcome"
        >
          <input type="hidden" name="packId" value={pack.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              {t.code}
              <input name="code" required maxLength={20} pattern="[A-Za-z0-9][A-Za-z0-9._\-]*" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1">
              {t.strand}
              <select name="strand" required className={inputClass}>
                {strands.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} · {s.name_en}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              {t.bloom}
              <select name="bloomLevel" required defaultValue="apply" className={inputClass}>
                {BLOOM_LEVELS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              {t.knowledgeType}
              <select name="knowledgeType" required defaultValue="procedural" className={inputClass}>
                {KNOWLEDGE_TYPES.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1">
            {t.description}
            <textarea name="description" required minLength={5} maxLength={1000} rows={2} className={`${inputClass} py-2`} />
          </label>
          <label className="flex flex-col gap-1">
            {t.indicators}
            <span className="text-sm text-zinc-700 dark:text-zinc-300">{t.indicatorsHint}</span>
            <textarea name="indicators" rows={3} className={`${inputClass} py-2 font-mono`} />
          </label>
          <label className="flex flex-col gap-1">
            {t.misconceptions}
            <span className="text-sm text-zinc-700 dark:text-zinc-300">{t.misconceptionsHint}</span>
            <textarea name="misconceptions" rows={3} className={`${inputClass} py-2 font-mono`} />
          </label>
          <label className="flex flex-col gap-1">
            {t.prerequisites}
            <span className="text-sm text-zinc-700 dark:text-zinc-300">{t.prerequisitesHint}</span>
            <input name="prerequisites" maxLength={300} className={inputClass} />
          </label>
        </ActionForm>
      </section>

      <section aria-labelledby="import-title" className={cardClass}>
        <h2 id="import-title" className="text-2xl font-semibold">
          {t.importTitle}
        </h2>
        <p>{t.importIntro}</p>
        <ImportForm packId={pack.id} />
      </section>

      <section aria-labelledby="strand-title" className={cardClass}>
        <h2 id="strand-title" className="text-2xl font-semibold">
          {t.strandsTitle}
        </h2>
        <ActionForm action={addStrand} submitLabel={t.addStrand} pendingLabel={en.auth.pending} errors={t.errors} success={t.strandAdded} testId="add-strand">
          <input type="hidden" name="packId" value={pack.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              {t.strandCode}
              <input name="code" required maxLength={10} pattern="[A-Za-z0-9]{1,10}" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1">
              {t.strandName}
              <input name="name" required minLength={2} maxLength={80} className={inputClass} />
            </label>
          </div>
        </ActionForm>
      </section>

      <section aria-labelledby="materials-title" className="flex flex-col gap-3">
        <h2 id="materials-title" className="text-2xl font-semibold">
          {t.materialsTitle}
        </h2>
        {materials.length === 0 ? (
          <p>{t.materialsEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="material-list">
            {materials.map((m) => (
              <li key={m.id} className={cardClass}>
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/teacher/material/${m.id}`} className="inline-flex min-h-11 items-center font-semibold underline">
                    {m.title}
                  </Link>
                  <StatusBadge status={m.status} label={t.materialStatus[m.status]} />
                  {m.score !== null && (
                    <span className="text-sm">
                      {t.score}: {m.score.toFixed(2)} / 3
                    </span>
                  )}
                </div>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">
                  {m.outcome_codes.join(", ")} · {t.licences[m.licence as keyof typeof t.licences] ?? m.licence}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="upload-title" className={cardClass}>
        <h2 id="upload-title" className="text-2xl font-semibold">
          {t.uploadTitle}
        </h2>
        <p>{t.uploadIntro}</p>
        {outcomes.length === 0 ? (
          <p>{t.outcomesEmpty}</p>
        ) : (
          <MaterialUploadForm packId={pack.id} outcomeCodes={outcomes.map((o) => o.code)} />
        )}
      </section>
    </>
  );
}
