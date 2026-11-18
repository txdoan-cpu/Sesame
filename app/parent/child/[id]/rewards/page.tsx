import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/app/_components/ActionForm";
import { buttonClass, cardClass, fill, inputClass, secondaryButtonClass } from "@/app/_components/styles";
import { getCurriculum } from "@/lib/curriculum";
import { getLang } from "@/lib/lang";
import { parentMessages } from "@/lib/i18n";
import { getRewardRules, requireLinkedChild } from "@/lib/portal";
import { REWARD_DEFAULT_RETENTION_DAYS, rewardFeasibility } from "@/lib/rewards";
import en from "@/messages/en.json";
import { createRewardRule, deleteRewardRule, markRewardFulfilled } from "../../actions";
import { ChildHeader } from "../ChildHeader";

export const metadata: Metadata = { title: "Reward goals — Sesame" };

export default function RewardsPage({ params }: PageProps<"/parent/child/[id]/rewards">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <Suspense fallback={<p>{en.app.loading}</p>}>
        <Rewards params={params} />
      </Suspense>
    </main>
  );
}

async function Rewards({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const child = await requireLinkedChild(id);
  const lang = await getLang();
  const t = parentMessages(lang);
  const r = t.portal.rewards;
  const [rules, curriculum] = await Promise.all([getRewardRules(id), getCurriculum()]);
  const today = new Date();
  const defaultDeadline = new Date(today.getTime() + 45 * 86_400_000).toISOString().slice(0, 10);
  const minDate = new Date(today.getTime() + 86_400_000).toISOString().slice(0, 10);

  return (
    <>
      <ChildHeader childId={id} childName={child.displayName} current="rewards" lang={lang} t={t.portal} langLabels={t.lang} />
      <h2 className="text-2xl font-semibold">{r.title}</h2>
      <p>{r.intro}</p>

      {rules.length === 0 ? (
        <p>{r.empty}</p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="reward-rules">
          {rules.map((rule) => {
            const f = rewardFeasibility(
              { outcomes: rule.outcomes, deadline: rule.deadline, retentionDays: rule.retention_days },
              new Set(rule.achievedOutcomes),
              today,
            );
            return (
              <li key={rule.id} className={cardClass} data-testid="reward-rule">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xl font-semibold">
                    {rule.reward_text}
                    {rule.value != null && ` (${rule.value} ${rule.currency})`}
                  </p>
                  <span className="rounded-full border-2 border-blue-700 px-3 text-sm font-medium">{r.statusLabel[rule.status]}</span>
                </div>
                <p className="font-mono">{rule.outcomes.join(", ")}</p>
                <p>{fill(r.terms, { score: Math.round(rule.min_score * 100), days: rule.retention_days, deadline: rule.deadline })}</p>
                <p>{fill(r.progress, rule.progress)}</p>
                <p className={rule.co_set ? "text-green-800 dark:text-green-300" : "text-zinc-700 dark:text-zinc-300"} data-testid="co-set">
                  {rule.co_set ? `✓ ${r.coSet}` : r.waiting}
                </p>
                {rule.learner_note && <p className="rounded-lg bg-blue-50 p-2 text-blue-950 dark:bg-blue-950 dark:text-blue-50">{fill(r.childNote, { note: rule.learner_note })}</p>}
                {rule.status === "active" && f.feasibility !== "on_track" && (
                  <p role="status" className="rounded-lg bg-amber-50 p-2 text-amber-950 dark:bg-amber-950 dark:text-amber-50" data-testid="feasibility">
                    ⚠ {r.feasibility[f.feasibility]}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {rule.status === "unlocked" && (
                    <form action={markRewardFulfilled}>
                      <input type="hidden" name="ruleId" value={rule.id} />
                      <input type="hidden" name="learnerId" value={id} />
                      <button type="submit" className={buttonClass}>
                        {r.markFulfilled}
                      </button>
                    </form>
                  )}
                  <form action={deleteRewardRule}>
                    <input type="hidden" name="ruleId" value={rule.id} />
                    <input type="hidden" name="learnerId" value={id} />
                    <button type="submit" className={secondaryButtonClass}>
                      {r.delete}
                    </button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <section aria-labelledby="new-goal" className={cardClass}>
        <h3 id="new-goal" className="text-xl font-semibold">
          {r.newTitle}
        </h3>
        <ActionForm
          action={createRewardRule}
          submitLabel={r.create}
          pendingLabel={t.auth.pending}
          errors={t.portal.errors}
          success={r.created}
          testId="reward-form"
        >
          <input type="hidden" name="learnerId" value={id} />
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 font-medium">{r.outcomes}</legend>
            {curriculum.map((s) => (
              <div key={s.code} className="flex flex-col gap-1">
                <p className="font-semibold">{lang === "vi" ? s.name_vi : s.name_en}</p>
                <div className="grid gap-1 md:grid-cols-2">
                  {s.outcomes.map((o) => (
                    <label key={o.code} className="flex min-h-11 items-center gap-2">
                      <input type="checkbox" name="outcomes" value={o.code} defaultChecked={o.code === "8PR2"} className="h-5 w-5" />
                      <span className="font-mono">{o.code}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </fieldset>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="font-medium">{r.minScore}</span>
              <input type="number" name="minScorePercent" min={50} max={100} defaultValue={80} required className={inputClass} />
            </label>
            <div className="flex flex-col gap-1">
              <label className="flex flex-col gap-1">
                <span className="font-medium">{r.retentionDays}</span>
                <input type="number" name="retentionDays" min={1} max={60} defaultValue={REWARD_DEFAULT_RETENTION_DAYS} required aria-describedby="retention-hint" className={inputClass} />
              </label>
              <span id="retention-hint" className="text-base text-zinc-700 dark:text-zinc-300">{r.retentionHint}</span>
            </div>
            <label className="flex flex-col gap-1">
              <span className="font-medium">{r.deadline}</span>
              <input type="date" name="deadline" min={minDate} defaultValue={defaultDeadline} required className={inputClass} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium">{r.value}</span>
              <input type="number" name="value" min={0} max={10000} step="1" className={inputClass} />
            </label>
          </div>
          <div className="flex flex-col gap-1">
            <label className="flex flex-col gap-1">
              <span className="font-medium">{r.rewardText}</span>
              <input type="text" name="rewardText" maxLength={120} required aria-describedby="reward-hint" className={inputClass} />
            </label>
            <span id="reward-hint" className="text-base text-zinc-700 dark:text-zinc-300">{r.rewardHint}</span>
          </div>
          <p className="text-base">{r.noPayments}</p>
        </ActionForm>
      </section>
    </>
  );
}
