"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass, inputClass } from "@/app/_components/styles";
import { LICENCES } from "@/lib/teacher/schemas";
import en from "@/messages/en.json";
import type { MaterialUploadResponse } from "../api/teacher/materials/route";

const t = en.teacher;

/** Uploads a file or a link with its licence; the server stores it and scores Rubric R. */
export function MaterialUploadForm({ packId, outcomeCodes }: { packId: string; outcomeCodes: string[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/teacher/materials", { method: "POST", body: new FormData(e.currentTarget) });
      const body = (await res.json().catch(() => ({ ok: false, code: "unknown" }))) as MaterialUploadResponse;
      if (body.ok) {
        router.push(`/teacher/material/${body.id}`);
        return;
      }
      const text = t.errors[body.code as keyof typeof t.errors] ?? t.errors.unknown;
      setError(body.detail ? `${text} (${body.detail})` : text);
    } catch {
      setError(t.errors.unknown);
    }
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" data-testid="material-upload">
      <input type="hidden" name="packId" value={packId} />
      <label className="flex flex-col gap-1">
        {t.materialTitle}
        <input name="title" required minLength={3} maxLength={200} className={inputClass} />
      </label>
      <fieldset className="flex flex-col gap-1">
        <legend>{t.forOutcomes}</legend>
        <div className="flex flex-wrap gap-2">
          {outcomeCodes.map((c, i) => (
            <label key={c} className="inline-flex min-h-11 items-center gap-2 rounded-lg border-2 border-zinc-300 px-3 dark:border-zinc-700">
              <input type="checkbox" name="outcomeCodes" value={c} defaultChecked={i === 0} className="h-5 w-5" />
              <span className="font-mono">{c}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1">
        {t.file}
        <input name="file" type="file" accept=".pdf,.txt,.md,.csv,.png,.jpg,.jpeg,.webp" className={`${inputClass} py-2`} />
      </label>
      <label className="flex flex-col gap-1">
        {t.link}
        <input name="sourceUrl" type="url" maxLength={500} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1">
        {t.licence}
        <select name="licence" required defaultValue="cc_by" className={inputClass}>
          {LICENCES.map((l) => (
            <option key={l} value={l}>
              {t.licences[l]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        {t.licenceNote}
        <span className="text-sm text-zinc-700 dark:text-zinc-300">{t.licenceNoteHint}</span>
        <textarea name="licenceNote" rows={2} maxLength={500} className={`${inputClass} py-2`} />
      </label>
      <div aria-live="polite">
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-900 dark:bg-red-950 dark:text-red-100">
            {error}
          </p>
        )}
      </div>
      <button type="submit" disabled={pending} className={`${buttonClass} self-start`}>
        {pending ? t.uploading : t.upload}
      </button>
    </form>
  );
}
