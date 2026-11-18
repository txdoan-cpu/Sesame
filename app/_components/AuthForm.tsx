"use client";

import { useActionState, useId } from "react";
import type { ActionState, AuthErrorCode } from "@/lib/auth/schemas";

export type FieldSpec = {
  name: string;
  label: string;
  type?: "text" | "email" | "password";
  autoComplete?: string;
  hint?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
};

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  fields: FieldSpec[];
  submitLabel: string;
  pendingLabel: string;
  errors: Partial<Record<AuthErrorCode, string>> & { unknown: string };
  successMessage?: string;
  testId?: string;
};

export function AuthForm({ action, fields, submitLabel, pendingLabel, errors, successMessage, testId }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const id = useId();
  const message = state.error ? (errors[state.error] ?? errors.unknown) : null;

  return (
    <form action={formAction} className="flex flex-col gap-4" data-testid={testId}>
      {fields.map((f) => {
        const inputId = `${id}-${f.name}`;
        const hintId = f.hint ? `${inputId}-hint` : undefined;
        return (
          <div key={f.name} className="flex flex-col gap-1">
            <label htmlFor={inputId} className="font-medium">
              {f.label}
            </label>
            <input
              id={inputId}
              name={f.name}
              type={f.type ?? "text"}
              autoComplete={f.autoComplete}
              required
              minLength={f.minLength}
              maxLength={f.maxLength}
              pattern={f.pattern}
              aria-describedby={hintId}
              autoCapitalize={f.type === "email" || f.name === "username" ? "none" : undefined}
              className="min-h-11 rounded-lg border-2 border-zinc-400 bg-white px-3 text-base text-zinc-900 focus:border-blue-700 focus:outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
            />
            {f.hint && (
              <p id={hintId} className="text-base text-zinc-700 dark:text-zinc-300">
                {f.hint}
              </p>
            )}
          </div>
        );
      })}

      <div aria-live="polite">
        {message && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-900 dark:bg-red-950 dark:text-red-100">
            {message}
          </p>
        )}
        {state.ok && successMessage && (
          <p className="rounded-lg bg-green-50 p-3 text-green-900 dark:bg-green-950 dark:text-green-100">
            {successMessage}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-lg bg-blue-700 px-5 font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
      >
        {pending ? pendingLabel : submitLabel}
      </button>
    </form>
  );
}
