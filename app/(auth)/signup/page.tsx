import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthForm } from "@/app/_components/AuthForm";
import { LangToggle } from "@/app/_components/LangToggle";
import { signUpParent } from "@/app/(auth)/actions";
import { getCurrentUser, homeFor } from "@/lib/auth/dal";
import { getLang } from "@/lib/lang";
import { parentMessages } from "@/lib/i18n";
import { supabaseEnv } from "@/lib/supabase/env";
import en from "@/messages/en.json";

export const metadata: Metadata = { title: "Create a parent account — Sesame" };

export default function SignUpPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<p>{en.app.loading}</p>}>
        <SignUpContent />
      </Suspense>
    </main>
  );
}

async function SignUpContent() {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user.role));

  const lang = await getLang();
  const t = parentMessages(lang);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">{t.auth.signUpTitle}</h1>
        <LangToggle current={lang} labels={t.lang} />
      </div>
      <p>{t.auth.signUpIntro}</p>

      {!supabaseEnv() && (
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-950 dark:bg-amber-950 dark:text-amber-100">
          {t.auth.notConfigured}
        </p>
      )}

      <AuthForm
        testId="parent-signup"
        action={signUpParent}
        fields={[
          { name: "displayName", label: t.auth.displayName, autoComplete: "name", maxLength: 60 },
          { name: "email", label: t.auth.email, type: "email", autoComplete: "email" },
          {
            name: "password",
            label: t.auth.password,
            type: "password",
            autoComplete: "new-password",
            hint: t.auth.passwordHint,
            minLength: 8,
            maxLength: 72,
          },
        ]}
        submitLabel={t.auth.signUpButton}
        pendingLabel={t.auth.pending}
        errors={t.auth.errors}
      />
      <p>
        {t.auth.haveAccount}{" "}
        <Link href="/login" className="inline-flex min-h-11 items-center font-medium underline">
          {t.app.loginLink}
        </Link>
      </p>
    </>
  );
}
