import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/app/_components/ActionForm";
import { buttonClass, cardClass, fill, inputClass, secondaryButtonClass } from "@/app/_components/styles";
import { getLang } from "@/lib/lang";
import { parentMessages } from "@/lib/i18n";
import { getChangeRequests, getSchedule, requireLinkedChild } from "@/lib/portal";
import { hhmm } from "@/lib/schedule";
import en from "@/messages/en.json";
import { addSlot, decideRequest, removeSlot } from "../../actions";
import { ChildHeader } from "../ChildHeader";

export const metadata: Metadata = { title: "Study schedule — Sesame" };

export default function SchedulePage({ params }: PageProps<"/parent/child/[id]/schedule">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <Suspense fallback={<p>{en.app.loading}</p>}>
        <Schedule params={params} />
      </Suspense>
    </main>
  );
}

async function Schedule({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const child = await requireLinkedChild(id);
  const lang = await getLang();
  const t = parentMessages(lang);
  const s = t.portal.schedule;
  const days = t.portal.days;
  const [slots, requests] = await Promise.all([getSchedule(id), getChangeRequests(id)]);

  return (
    <>
      <ChildHeader childId={id} childName={child.displayName} current="schedule" lang={lang} t={t.portal} langLabels={t.lang} />

      <section aria-labelledby="slots" className={cardClass}>
        <h2 id="slots" className="text-2xl font-semibold">
          {s.title}
        </h2>
        {slots.length === 0 ? (
          <p>{s.empty}</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="slots">
            {slots.map((slot) => (
              <li key={slot.id} className="flex flex-wrap items-center justify-between gap-2" data-testid="slot">
                <span>{fill(s.slot, { day: days[slot.weekday], time: hhmm(slot.start_time), minutes: slot.duration_min })}</span>
                <form action={removeSlot}>
                  <input type="hidden" name="slotId" value={slot.id} />
                  <input type="hidden" name="learnerId" value={id} />
                  <button type="submit" className={secondaryButtonClass}>
                    {s.remove}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <ActionForm
          action={addSlot}
          submitLabel={s.add}
          pendingLabel={t.auth.pending}
          errors={t.portal.errors}
          success={s.added}
          testId="slot-form"
          className="flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="learnerId" value={id} />
          <div className="flex flex-col gap-1">
            <label htmlFor="slot-weekday" className="font-medium">{s.weekday}</label>
            <select id="slot-weekday" name="weekday" defaultValue="1" className={inputClass}>
              {days.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <label className="flex flex-col gap-1">
            <span className="font-medium">{s.start}</span>
            <input type="time" name="startTime" defaultValue="16:30" required className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium">{s.duration}</span>
            <input type="number" name="durationMin" min={10} max={120} defaultValue={20} required className={`${inputClass} w-28`} />
          </label>
        </ActionForm>
      </section>

      <section aria-labelledby="requests" className={cardClass}>
        <h2 id="requests" className="text-2xl font-semibold">
          {s.requests}
        </h2>
        {requests.length === 0 ? (
          <p>{s.noRequests}</p>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="requests">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 rounded-lg border-2 border-zinc-300 p-3 dark:border-zinc-700" data-testid="request">
                <p>
                  {fill(s.request, { day: days[r.weekday], time: hhmm(r.start_time), minutes: r.duration_min })} {!r.schedule_id && s.requestNew}
                </p>
                {r.note && <p>{fill(s.requestNote, { note: r.note })}</p>}
                <p className="font-medium">{s.requestStatus[r.status]}</p>
                {r.status === "pending" && (
                  <div className="flex flex-wrap gap-2">
                    {(["approved", "declined"] as const).map((decision) => (
                      <form key={decision} action={decideRequest}>
                        <input type="hidden" name="requestId" value={r.id} />
                        <input type="hidden" name="learnerId" value={id} />
                        <input type="hidden" name="decision" value={decision} />
                        <button type="submit" className={decision === "approved" ? buttonClass : secondaryButtonClass}>
                          {decision === "approved" ? s.approve : s.decline}
                        </button>
                      </form>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
