import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/app/_components/ActionForm";
import { cardClass, fill, inputClass } from "@/app/_components/styles";
import { getLang } from "@/lib/lang";
import { parentMessages } from "@/lib/i18n";
import { requireLinkedChild } from "@/lib/portal";
import en from "@/messages/en.json";
import { resetChildPassword } from "../../actions";
import { ChildHeader } from "../ChildHeader";

export const metadata: Metadata = { title: "Account — Sesame" };

export default function AccountPage({ params }: PageProps<"/parent/child/[id]/account">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <Suspense fallback={<p>{en.app.loading}</p>}>
        <Account params={params} />
      </Suspense>
    </main>
  );
}

async function Account({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const child = await requireLinkedChild(id);
  const lang = await getLang();
  const t = parentMessages(lang);
  const a = t.portal.account;

  return (
    <>
      <ChildHeader childId={id} childName={child.displayName} current="account" lang={lang} t={t.portal} langLabels={t.lang} />
      <section aria-labelledby="reset" className={cardClass}>
        <h2 id="reset" className="text-2xl font-semibold">
          {a.resetTitle}
        </h2>
        <p>{fill(a.resetIntro, { username: child.username })}</p>
        <ActionForm
          action={resetChildPassword}
          submitLabel={a.reset}
          pendingLabel={t.auth.pending}
          errors={t.portal.errors}
          success={a.resetDone}
          testId="reset-form"
        >
          <input type="hidden" name="learnerId" value={id} />
          <div className="flex flex-col gap-1">
            <label className="flex flex-col gap-1">
              <span className="font-medium">{a.newPassword}</span>
              <input type="password" name="password" minLength={8} maxLength={72} autoComplete="new-password" required aria-describedby="pw-hint" className={inputClass} />
            </label>
            <span id="pw-hint" className="text-base text-zinc-700 dark:text-zinc-300">{t.auth.passwordHint}</span>
          </div>
        </ActionForm>
      </section>
    </>
  );
}
