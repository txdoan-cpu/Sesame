import { ActionForm } from "@/app/_components/ActionForm";
import { cardClass, fill, inputClass, longDate, secondaryButtonClass } from "@/app/_components/styles";
import { learnerMessages } from "@/lib/i18n";
import type { ChangeRequest, RewardRuleView } from "@/lib/portal";
import { hhmm, type Slot } from "@/lib/schedule";
import en from "@/messages/en.json";
import { replyToReward, requestScheduleChange } from "./actions";

const t = learnerMessages.home;
const days = en.portal.days;
const statusText = en.portal.rewards.statusLabel;
const requestStatus = t.requestStatus;

/** Goals my parent set (accept or suggest a change), and my study times (ask for a change). */
export function FamilyPlans({ rules, slots, requests }: { rules: RewardRuleView[]; slots: Slot[]; requests: ChangeRequest[] }) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <section aria-labelledby="goals" className={cardClass} data-testid="my-rewards">
        <h2 id="goals" className="text-2xl font-semibold">
          {t.rewardsTitle}
        </h2>
        {rules.length === 0 ? (
          <p>{t.rewardsEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {rules.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 rounded-lg border-2 border-zinc-300 p-3 dark:border-zinc-700" data-testid="my-reward">
                <p className="text-lg font-semibold">{fill(t.rewardPrize, { reward: r.reward_text })}</p>
                <p>
                  {fill(t.rewardLine, {
                    outcomes: r.outcomes.join(", "),
                    score: Math.round(r.min_score * 100),
                    days: r.retention_days,
                    deadline: longDate(r.deadline),
                  })}
                </p>
                <p>
                  {fill(en.portal.rewards.progress, r.progress)} · {statusText[r.status]}
                </p>
                {r.co_set ? (
                  <p className="font-medium text-green-800 dark:text-green-300">✓ {t.accepted}</p>
                ) : (
                  <>
                    {r.learner_note && <p>{fill(t.youSuggested, { note: r.learner_note })}</p>}
                    <ActionForm
                      action={replyToReward}
                      submitLabel={t.accept}
                      pendingLabel={en.learner.lesson.ask.sending}
                      errors={t.errors}
                      success={{ accepted: t.accepted, suggested: t.suggested }}
                      className="flex flex-col gap-2"
                    >
                      <input type="hidden" name="ruleId" value={r.id} />
                      <input type="hidden" name="action" value="accept" />
                    </ActionForm>
                    <details>
                      <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium underline">{t.suggest}</summary>
                      <ActionForm
                        action={replyToReward}
                        submitLabel={t.send}
                        pendingLabel={en.learner.lesson.ask.sending}
                        errors={t.errors}
                        success={{ accepted: t.accepted, suggested: t.suggested }}
                        className="mt-2 flex flex-col gap-2"
                        submitClassName={secondaryButtonClass}
                      >
                        <input type="hidden" name="ruleId" value={r.id} />
                        <input type="hidden" name="action" value="suggest" />
                        <label className="flex flex-col gap-1">
                          <span className="font-medium">{t.suggestLabel}</span>
                          <textarea name="note" rows={2} maxLength={300} required className={`${inputClass} py-2`} />
                        </label>
                      </ActionForm>
                    </details>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="times" className={cardClass} data-testid="my-schedule">
        <h2 id="times" className="text-2xl font-semibold">
          {t.scheduleTitle}
        </h2>
        {slots.length === 0 ? (
          <p>{t.scheduleEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {slots.map((s) => (
              <li key={s.id}>{fill(en.portal.schedule.slot, { day: days[s.weekday], time: hhmm(s.start_time), minutes: s.duration_min })}</li>
            ))}
          </ul>
        )}
        <details>
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium underline">{t.requestTitle}</summary>
          <ActionForm
            action={requestScheduleChange}
            submitLabel={t.requestSend}
            pendingLabel={en.learner.lesson.ask.sending}
            errors={t.errors}
            success={t.requestSent}
            testId="request-form"
            className="mt-2 flex flex-col gap-3"
          >
            <div className="flex flex-col gap-1">
              <label htmlFor="req-scheduleId" className="font-medium">{t.requestFor}</label>
              <select id="req-scheduleId" name="scheduleId" defaultValue="" className={inputClass}>
                <option value="">{t.newTime}</option>
                {slots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {fill(en.portal.schedule.slot, { day: days[s.weekday], time: hhmm(s.start_time), minutes: s.duration_min })}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="req-weekday" className="font-medium">{en.portal.schedule.weekday}</label>
                <select id="req-weekday" name="weekday" defaultValue="2" className={inputClass}>
                  {days.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex flex-col gap-1">
                <span className="font-medium">{en.portal.schedule.start}</span>
                <input type="time" name="startTime" defaultValue="17:00" required className={inputClass} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-medium">{en.portal.schedule.duration}</span>
                <input type="number" name="durationMin" min={10} max={120} defaultValue={20} required className={`${inputClass} w-28`} />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="font-medium">{t.note}</span>
              <input type="text" name="note" maxLength={300} className={inputClass} />
            </label>
          </ActionForm>
        </details>
        {requests.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold">{t.requestsTitle}</h3>
            <ul className="flex flex-col gap-1" data-testid="my-requests">
              {requests.map((r) => (
                <li key={r.id}>
                  {fill(en.portal.schedule.slot, { day: days[r.weekday], time: hhmm(r.start_time), minutes: r.duration_min })}:{" "}
                  {requestStatus[r.status]}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
