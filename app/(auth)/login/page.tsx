import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthForm } from "@/app/_components/AuthForm";
import { LangToggle } from "@/app/_components/LangToggle";
import { loginLearner, loginParent } from "@/app/(auth)/actions";
import { getCurrentUser, homeFor } from "@/lib/auth/dal";
import { getLang } from "@/lib/lang";
import { learnerMessages, parentMessages } from "@/lib/i18n";
import { supabaseEnv } from "@/lib/supabase/env";
import en from "@/messages/en.json";

export const metadata: Metadata = { title: "Log in — Sesame" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<p>{en.app.loading}</p>}>
        <LoginContent />
      </Suspense>
    </main>
  );
}

async function LoginContent() {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user.role));

  const lang = await getLang();
  const t = parentMessages(lang);
  const l = learnerMessages.login;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">{t.auth.loginTitle}</h1>
        <LangToggle current={lang} labels={t.lang} />
      </div>

      {!supabaseEnv() && (
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-950 dark:bg-amber-950 dark:text-amber-100">
          {t.auth.notConfigured}
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <section lang="en-CA" aria-labelledby="learner-login" className="flex flex-col gap-4 rounded-xl border-2 border-zinc-300 p-5 dark:border-zinc-700">
          <h2 id="learner-login" className="text-2xl font-semibold">
            {l.title}
          </h2>
          <AuthForm
            testId="learner-login"
            action={loginLearner}
            fields={[
              { name: "username", label: l.username, autoComplete: "username" },
              { name: "password", label: l.password, type: "password", autoComplete: "current-password" },
            ]}
            submitLabel={l.button}
            pendingLabel={l.pending}
            errors={l.errors}
          />
        </section>

        <section aria-labelledby="parent-login" className="flex flex-col gap-4 rounded-xl border-2 border-zinc-300 p-5 dark:border-zinc-700">
          <h2 id="parent-login" className="text-2xl font-semibold">
            {t.auth.parentLoginTitle}
          </h2>
          <AuthForm
            testId="parent-login"
            action={loginParent}
            fields={[
              { name: "email", label: t.auth.email, type: "email", autoComplete: "email" },
              { name: "password", label: t.auth.password, type: "password", autoComplete: "current-password" },
            ]}
            submitLabel={t.auth.loginButton}
            pendingLabel={t.auth.pending}
            errors={t.auth.errors}
          />
          <p>
            {t.auth.noAccount}{" "}
            <Link href="/signup" className="inline-flex min-h-11 items-center font-medium underline">
              {t.app.signUpLink}
            </Link>
          </p>
        </section>
      </div>
    </>
  );
}
