"use client";

import { useState, useTransition } from "react";
import { buttonClass, fill, inputClass } from "@/app/_components/styles";
import en from "@/messages/en.json";
import { previewImport, saveImport, type PreviewResult } from "./actions";

const t = en.teacher;

/** CSV/JSON import: check the file on the server (preview), then save if every row is OK. */
export function ImportForm({ packId }: { packId: string }) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setPreview(null);
    setMessage(null);
    setFile(f ? { name: f.name, text: await f.text() } : null);
  }

  function check() {
    if (!file) return;
    start(async () => {
      setMessage(null);
      setPreview(await previewImport(file.name, file.text));
    });
  }

  function save() {
    if (!file) return;
    start(async () => {
      const r = await saveImport(packId, file.name, file.text);
      if (r.error) {
        setMessage({ kind: "error", text: t.errors[r.error as keyof typeof t.errors] ?? r.error });
      } else {
        setMessage({ kind: "ok", text: fill(t.imported, { n: r.saved ?? 0 }) });
        setPreview(null);
      }
    });
  }

  const allReady = preview && !preview.fileError && preview.rows.length > 0 && preview.ready === preview.rows.length;

  return (
    <div className="flex flex-col gap-4" data-testid="import-form">
      <label className="flex flex-col gap-1">
        {t.chooseFile}
        <input type="file" accept=".csv,.json,text/csv,application/json" onChange={onFile} className={`${inputClass} py-2`} />
      </label>
      <button type="button" onClick={check} disabled={!file || pending} className={`${buttonClass} self-start`}>
        {pending ? en.auth.pending : t.preview}
      </button>

      {preview?.fileError && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-900 dark:bg-red-950 dark:text-red-100">
          {preview.fileError}
        </p>
      )}
      {preview && !preview.fileError && (
        <div className="flex flex-col gap-3">
          <h3 className="text-xl font-semibold">{t.previewTitle}</h3>
          <p data-testid="import-ready">{fill(t.ready, { n: preview.ready, total: preview.rows.length })}</p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm" data-testid="import-preview">
              <thead>
                <tr className="border-b-2 border-zinc-300 dark:border-zinc-700">
                  <th className="p-2">{t.line}</th>
                  <th className="p-2">{t.code}</th>
                  <th className="p-2">{t.description}</th>
                  <th className="p-2">{t.issues}</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.line} className="border-b border-zinc-200 align-top dark:border-zinc-800">
                    <td className="p-2">{r.line}</td>
                    <td className="p-2 font-mono">{r.input?.code ?? String(r.raw.code ?? "")}</td>
                    <td className="p-2">{r.input?.description ?? String(r.raw.description ?? "")}</td>
                    <td className="p-2">
                      {r.issues.length === 0 ? (
                        <span className="font-semibold text-green-800 dark:text-green-300">{t.ok}</span>
                      ) : (
                        <ul className="list-disc pl-4 text-red-800 dark:text-red-300">
                          {r.issues.map((i) => (
                            <li key={i}>{i}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {allReady ? (
            <button type="button" onClick={save} disabled={pending} className={`${buttonClass} self-start`}>
              {fill(t.saveImport, { n: preview.ready })}
            </button>
          ) : (
            <p>{t.errors.fix_issues_first}</p>
          )}
        </div>
      )}
      <div aria-live="polite">
        {message && (
          <p
            role={message.kind === "error" ? "alert" : undefined}
            className={
              message.kind === "error"
                ? "rounded-lg bg-red-50 p-3 text-red-900 dark:bg-red-950 dark:text-red-100"
                : "rounded-lg bg-green-50 p-3 text-green-900 dark:bg-green-950 dark:text-green-100"
            }
          >
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
