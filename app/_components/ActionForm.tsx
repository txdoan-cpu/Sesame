"use client";

import { useActionState, type ReactNode } from "react";

type State = { error?: string; ok?: boolean | string };

type Props<S extends State> = {
  action: (prev: S, formData: FormData) => Promise<S>;
  submitLabel: string;
  pendingLabel: string;
  /** Message per error code; `unknown` is the fallback. */
  errors: Record<string, string> & { unknown?: string };
  /** Shown after success. A map lets `ok` carry which success it was. */
  success?: string | Record<string, string>;
  testId?: string;
  className?: string;
  submitClassName?: string;
  children: ReactNode;
};

/** A server-action form with pending, error and success states. Fields are passed as children. */
export function ActionForm<S extends State>({
  action,
  submitLabel,
  pendingLabel,
  errors,
  success,
  testId,
  className = "flex flex-col gap-4",
  submitClassName = "min-h-11 self-start rounded-lg bg-blue-700 px-5 font-semibold text-white disabled:opacity-60",
  children,
}: Props<S>) {
  // S is a plain object type, so Awaited<S> is S; the cast only satisfies the hook's typing.
  const [state, formAction, pending] = useActionState<S, FormData>(
    action as (prev: Awaited<S>, formData: FormData) => Promise<S>,
    {} as Awaited<S>,
  );
  const errorText = state.error ? (errors[state.error] ?? errors.unknown ?? state.error) : null;
  const successText =
    state.ok && success ? (typeof success === "string" ? success : success[String(state.ok)] ?? null) : null;

  return (
    <form action={formAction} className={className} data-testid={testId}>
      {children}
      <div aria-live="polite">
        {errorText && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-900 dark:bg-red-950 dark:text-red-100">
            {errorText}
          </p>
        )}
        {successText && (
          <p className="rounded-lg bg-green-50 p-3 text-green-900 dark:bg-green-950 dark:text-green-100">{successText}</p>
        )}
      </div>
      <button type="submit" disabled={pending} className={submitClassName}>
        {pending ? pendingLabel : submitLabel}
      </button>
    </form>
  );
}
