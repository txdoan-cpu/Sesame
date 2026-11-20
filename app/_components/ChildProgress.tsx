import type en from "@/messages/en.json";
import type { Lang } from "@/lib/i18n";
import type { StrandWithOutcomes, MisconceptionInfo } from "@/lib/curriculum";
import type { ChildView, NotificationView, RationaleView, RewardRuleView } from "@/lib/portal";
import type { SharingItem } from "@/lib/sharing";
import type { WeeklySummary } from "@/lib/weekly";
import { OutcomeBoard } from "./OutcomeBoard";
import { cardClass, fill } from "./styles";

type PortalMessages = typeof en.portal;

type Props = {
  view: ChildView;
  rewards: RewardRuleView[];
  curriculum: StrandWithOutcomes[];
  misconceptionInfo: MisconceptionInfo[];
  /** Parent's safety alerts about this child; null on the learner's preview (they cannot read them). */
  safetyAlerts: NotificationView[] | null;
  week: WeeklySummary;
  rationale: RationaleView | null;
  t: PortalMessages;
  lang: Lang;
};

/** Proposal's rationale card: what was noticed → what the lesson does → which criteria it meets. */
function RationaleCard({ rationale, t, lang }: { rationale: RationaleView; t: PortalMessages; lang: Lang }) {
  const r = t.rationale;
  return (
    <section aria-labelledby="h-why" className={cardClass} data-testid="rationale">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="h-why" className="text-xl font-semibold">
          {r.title}
        </h2>
        <span className="rounded-full bg-green-700 px-3 text-sm font-semibold text-white" data-testid="fit-score">
          {fill(r.fit, { score: rationale.fitScore })}
        </span>
      </div>
      <p>{fill(r.intro, { outcome: rationale.outcome })}</p>
      <ul className="flex flex-col gap-3">
        {rationale.rows.map((row, i) => (
          <li key={i} className="flex flex-col gap-1 rounded-lg bg-zinc-100 p-3 dark:bg-zinc-900" data-testid="rationale-row">
            <p>
              <span className="font-semibold">{r.signal}:</span> {row.signal[lang]}
            </p>
            <p>
              <span className="font-semibold">{r.method}:</span> {row.method[lang]}
            </p>
            <p className="flex flex-wrap gap-1">
              {row.criteria.map((c) => (
                <span key={c} className="rounded-full border-2 border-zinc-400 px-2 text-sm">
                  {c} · {r.criteria[c as keyof typeof r.criteria]}
                </span>
              ))}
            </p>
          </li>
        ))}
      </ul>
      {rationale.hidden > 0 && (
        <p className="italic" data-testid="rationale-hidden">
          {fill(r.hidden, { n: rationale.hidden })}
        </p>
      )}
      <p className="text-base text-zinc-700 dark:text-zinc-300">{r.fitNote}</p>
    </section>
  );
}

/** The weekly report, live: attendance (locked), active time, outcomes if shared. */
function ThisWeek({ week, t }: { week: WeeklySummary; t: PortalMessages }) {
  const w = t.thisWeek;
  return (
    <section aria-labelledby="h-week" className={`${cardClass} border-blue-700`} data-testid="this-week">
      <h2 id="h-week" className="text-xl font-semibold">
        {w.title}
      </h2>
      <p>{fill(w.sessions, { attended: week.attended, scheduled: week.scheduled })}</p>
      <p>{fill(w.active, { active: week.activeMinutes, idle: week.idleMinutes })}</p>
      {week.sessions > 0 && <p>{fill(w.engagement, week.engagement)}</p>}
      {week.outcomesAchieved !== null && (
        <p>{week.outcomesAchieved.length ? fill(w.outcomes, { list: week.outcomesAchieved.join(", ") }) : w.noOutcomes}</p>
      )}
      <p className="text-base text-zinc-700 dark:text-zinc-300">{w.note}</p>
    </section>
  );
}

function date(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleDateString(lang === "vi" ? "vi-VN" : "en-CA", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Everything a parent sees about a child, section by section (§7.3).
 * Unshared items show "Your child is keeping this private" instead of data.
 * The learner's "What my parent sees" page renders this same component.
 */
function SharedSection({
  item,
  sharing,
  t,
  children,
}: {
  item: SharingItem;
  sharing: ChildView["sharing"];
  t: PortalMessages;
  children: React.ReactNode;
}) {
  const s = sharing[item];
  return (
    <section aria-labelledby={`h-${item}`} className={cardClass} data-testid={`section-${item}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`h-${item}`} className="text-xl font-semibold">
          {t.items[item]}
        </h2>
        {s.locked && <span className="rounded-full border-2 border-zinc-400 px-3 text-sm">🔒 {t.locked}</span>}
      </div>
      {s.shared ? (
        children
      ) : (
        <p className="italic" data-testid={`private-${item}`}>
          {t.private}
        </p>
      )}
    </section>
  );
}

export function ChildProgress({ view, rewards, curriculum, misconceptionInfo, safetyAlerts, week, rationale, t, lang }: Props) {
  const status = view.outcomeStatus ? Object.fromEntries(view.outcomeStatus.map((o) => [o.outcome_code, o.status])) : {};

  return (
    <div className="flex flex-col gap-5">
      <ThisWeek week={week} t={t} />
      {rationale && <RationaleCard rationale={rationale} t={t} lang={lang} />}
      <SharedSection item="attendance" sharing={view.sharing} t={t}>
        {view.attendance.length === 0 ? (
          <p>{t.attendanceEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {view.attendance.map((s) => (
              <li key={s.id}>
                {fill(t.attendanceRow, {
                  date: date(s.started_at ?? s.scheduled_for ?? new Date().toISOString(), lang),
                  active: Math.round(s.active_seconds / 60),
                  idle: Math.round(s.idle_seconds / 60),
                })}
                {s.engagement && ` (${t.engagement[s.engagement as keyof typeof t.engagement] ?? s.engagement})`}
              </li>
            ))}
          </ul>
        )}
      </SharedSection>

      <SharedSection item="safety_alerts" sharing={view.sharing} t={t}>
        {safetyAlerts === null ? (
          <p>{t.safetyLearnerNote}</p>
        ) : safetyAlerts.length === 0 ? (
          <p>{t.safetyEmpty}</p>
        ) : (
          <>
            <ul className="flex flex-col gap-2" data-testid="safety-alerts">
              {safetyAlerts.map((n) => (
                <li key={n.id} className="rounded-lg border-2 border-amber-600 bg-amber-50 p-3 text-amber-950 dark:bg-amber-950 dark:text-amber-50">
                  {fill(t.safetyAlert, {
                    date: date(n.created_at, lang),
                    category: t.safetyCategory[String(n.payload.category) as keyof typeof t.safetyCategory] ?? String(n.payload.category),
                  })}
                </li>
              ))}
            </ul>
            <p>{t.safetyAdvice}</p>
          </>
        )}
      </SharedSection>

      <SharedSection item="reward_progress" sharing={view.sharing} t={t}>
        {rewards.length === 0 ? (
          <p>{t.rewards.empty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rewards.map((r) => (
              <li key={r.id} data-testid="reward-progress">
                <strong>{r.reward_text}</strong>: {fill(t.rewards.progress, r.progress)} · {t.rewards.statusLabel[r.status]}
              </li>
            ))}
          </ul>
        )}
      </SharedSection>

      <SharedSection item="outcome_status" sharing={view.sharing} t={t}>
        <p className="text-base">{t.statusLegend}</p>
        <OutcomeBoard
          strands={curriculum.map((s) => ({
            code: s.code,
            name: lang === "vi" ? s.name_vi : s.name_en,
            outcomes: s.outcomes.map((o) => ({ code: o.code, text: lang === "vi" ? o.description_vi : o.parent_friendly })),
          }))}
          status={status}
          statusLabels={t.status}
        />
      </SharedSection>

      <SharedSection item="scores" sharing={view.sharing} t={t}>
        {!view.scores || view.scores.length === 0 ? (
          <p>{t.scoresEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="scores">
            {view.scores.map((s) => (
              <li key={s.id}>
                {date(s.taken_at, lang)}: {fill(t.scoreRow, { outcome: s.outcome_code, score: Math.round(s.score * 100) })}
                {s.mastered && <span className="ml-2 rounded-full bg-green-700 px-2 text-sm text-white">{t.masteredTag}</span>}
              </li>
            ))}
          </ul>
        )}
      </SharedSection>

      <SharedSection item="question_summaries" sharing={view.sharing} t={t}>
        {!view.questions || view.questions.length === 0 ? (
          <p>{t.questionsEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="questions">
            {view.questions.map((q) => (
              <li key={q.id}>
                {date(q.created_at, lang)}: “{q.text}”{q.indicator && ` (${q.indicator})`}
              </li>
            ))}
          </ul>
        )}
      </SharedSection>

      <SharedSection item="learning_pace" sharing={view.sharing} t={t}>
        <p data-testid="learning-pace">{t.pace[view.learningPace ?? "unknown"]}</p>
      </SharedSection>

      <SharedSection item="misconceptions" sharing={view.sharing} t={t}>
        {!view.misconceptions || view.misconceptions.length === 0 ? (
          <p>{t.misconceptionsEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="misconceptions">
            {view.misconceptions.map((code) => {
              const info = misconceptionInfo.find((m) => m.code === code);
              return (
                <li key={code}>
                  <span className="font-mono font-semibold">{code}</span>: {info ? (lang === "vi" ? info.description_vi : info.description) : ""}
                </li>
              );
            })}
          </ul>
        )}
      </SharedSection>
    </div>
  );
}
