// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@/ui/primitives";
import { apiJson } from "../media/upload-client";

type Progress = { generation: string; sourceUrl: string | null; sourceOrigin: string | null; recoveryResponseId: string | null; requests: number; pages: number; pending: number; indexed: number; capturedBytes: number; expired: boolean; busy: boolean; recoveryRequired: boolean; invalidated: boolean; planReady: boolean; cleanupPending: boolean };
type Labels = { intro: string; advance: string; pause: string; working: string; saved: string; failed: string; stop: string; stopped: string; expired: string; recovery: string; cleanup: string; requests: string; pages: string; indexed: string; pending: string; bytes: string; origin: string; url: string; restartIntro: string; restart: string; confirmRestart: string; verifyOriginal: string; confirmOriginal: string; storageRecovery: string; freshVerification: string };

export function CrawlImportControls({ id, progress, owner, labels }: { id: string; progress: Progress; owner: boolean; labels: Labels }) {
  const router = useRouter(), pause = useRef(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null), [error, setError] = useState(false);
  async function advance() {
    pause.current = false; setBusy(true); setError(false); setMessage(labels.working);
    try {
      // Authentication and the server's 600/hour limit apply to every actual
      // bounded phase. Pause leaves an in-flight receipt to finish normally.
      for (let phase = 0; phase < 600 && !pause.current; phase++) {
        const result = await apiJson<{ step: string }>("/api/v1/imports.advanceCrawl", { method: "POST", body: JSON.stringify({ id, generation: progress.generation }) });
        if (result.step === "recovery") { setError(true); setMessage(labels.recovery); break; }
        setMessage(labels.saved);
        if (result.step === "previewed") break;
      }
    } catch { setError(true); setMessage(labels.failed); }
    finally { setBusy(false); router.refresh(); }
  }
  async function stop() {
    setBusy(true); setError(false);
    try {
      await apiJson("/api/v1/imports.cancelCrawl", { method: "POST", body: JSON.stringify({ id }) });
      setMessage(labels.stopped);
    } catch { setError(true); setMessage(labels.failed); }
    finally { setBusy(false); router.refresh(); }
  }
  async function recover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(false);
    try {
      await apiJson("/api/v1/imports.recoverCrawlResponse", { method: "POST", body: JSON.stringify({ id, generation: progress.generation, responseId: progress.recoveryResponseId, confirmation: "VERIFY ORIGINAL RESPONSE" }) });
      setMessage(labels.saved);
    } catch { setError(true); setMessage(labels.recovery); }
    finally { setBusy(false); router.refresh(); }
  }
  async function restart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError(false);
    try {
      const created = await apiJson<{ id: string }>("/api/v1/imports.restartCrawlReview", { method: "POST", body: JSON.stringify({ id, generation: progress.generation, origin: form.get("origin"), url: form.get("url"), confirmation: "START NEW SOURCE REVIEW" }) });
      router.push(`/admin/imports/${encodeURIComponent(created.id)}`); router.refresh();
    } catch { setBusy(false); setError(true); setMessage(labels.failed); }
  }
  const canAdvance = !progress.planReady && !progress.expired && !progress.invalidated && !progress.recoveryRequired;
  return <div className="grid min-w-0 gap-4">
    <p className="max-w-prose text-sm text-ink-muted">{labels.intro}</p>
    {progress.sourceUrl ? <p className="min-w-0 break-all text-sm"><bdi dir="ltr">{progress.sourceUrl}</bdi></p> : null}
    <dl className="grid min-w-0 grid-cols-2 gap-3 text-sm sm:grid-cols-3">
      {[[labels.requests, progress.requests], [labels.pages, progress.pages], [labels.indexed, progress.indexed], [labels.pending, progress.pending], [labels.bytes, progress.capturedBytes]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="break-words text-ink-muted">{label}</dt><dd className="break-all font-medium">{value}</dd></div>)}
    </dl>
    {progress.expired ? <p role="status" className="text-sm text-ink-muted">{labels.expired}</p> : null}
    {progress.recoveryRequired ? <p role="status" className="text-sm text-ink-muted">{labels.recovery}</p> : null}
    {progress.cleanupPending ? <p role="status" className="text-sm text-ink-muted">{labels.cleanup}</p> : null}
    {message ? <p role={error ? "alert" : "status"} className={error ? "text-sm text-danger" : "text-sm text-ink-muted"}>{message}</p> : null}
    <div className="flex flex-wrap gap-3">
      {canAdvance ? <Button type="button" disabled={busy || progress.busy} onClick={() => void advance()}>{labels.advance}</Button> : null}
      {busy ? <Button type="button" variant="quiet" onClick={() => { pause.current = true; }}>{labels.pause}</Button> : null}
      {!progress.invalidated ? <Button type="button" variant="danger" disabled={busy} onClick={() => void stop()}>{labels.stop}</Button> : null}
    </div>
    {owner && (progress.expired || progress.recoveryRequired || progress.invalidated) ? <div className="grid min-w-0 gap-4 border-t border-rule pt-4">
      <a className="text-sm text-accent underline" href={`/security/verify?returnTo=${encodeURIComponent(`/admin/imports/${id}`)}`}>{labels.freshVerification}</a>
      {progress.recoveryResponseId && !progress.expired && !progress.invalidated ? <form onSubmit={event => void recover(event)} className="grid min-w-0 gap-3">
        <a href="/admin/media/recovery" className="text-sm text-accent underline">{labels.storageRecovery}</a>
        <label className="flex min-w-0 items-start gap-2 text-sm"><input type="checkbox" required disabled={busy} className="mt-1" /><span className="min-w-0 break-words">{labels.confirmOriginal}</span></label>
        <Button type="submit" disabled={busy}>{labels.verifyOriginal}</Button>
      </form> : null}
      {progress.sourceUrl ? <form onSubmit={event => void restart(event)} className="grid min-w-0 gap-3">
        <p className="max-w-prose text-sm text-ink-muted">{labels.restartIntro}</p>
        <Field htmlFor="crawl-restart-origin" label={labels.origin}><Input id="crawl-restart-origin" name="origin" type="url" defaultValue={progress.sourceOrigin ?? ""} maxLength={8192} required disabled={busy} /></Field>
        <Field htmlFor="crawl-restart-url" label={labels.url}><Input id="crawl-restart-url" name="url" type="url" defaultValue={progress.sourceUrl} maxLength={8192} required disabled={busy} /></Field>
        <label className="flex min-w-0 items-start gap-2 text-sm"><input type="checkbox" required disabled={busy} className="mt-1" /><span className="min-w-0 break-words">{labels.confirmRestart}</span></label>
        <Button type="submit" disabled={busy}>{labels.restart}</Button>
      </form> : null}
    </div> : null}
  </div>;
}
