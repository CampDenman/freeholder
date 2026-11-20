// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select } from "@/ui/primitives";
import type { ImportGraphVersion } from "@/core/import/graph-version";
import { apiJson } from "../media/upload-client";
import { SourceUploadForm } from "./ImportForms";

type Operation = "index" | "commit" | "reconcile" | "publish" | "rollback";
type Reply = { status: string; counts?: unknown; sourceRestored?: boolean };
type Upload = { uploadId: string; chunks: number; received: number; expiresAt: string };
type Labels = {
  intro: string; index: string; commit: string; pause: string; working: string; failed: string; saved: string;
  restoreHint: string; limits: string; reviewHint: string; review: string; slug: string; slugHint: string; keep: string; replace: string; rename: string; renamedSlug: string;
  reconcile: string; publish: string; rollback: string; upload: string; uploadHint: string; stage: string; uploading: string; readingSource: string; uploadFailed: string;
};

export function GraphImportControls({ id, status, sourceKind, version, upload, indexComplete, planFrozen, planReady, invalidated, liveSource = false, labels }: { id: string; status: string; sourceKind: string; version: ImportGraphVersion; upload: Upload | null; indexComplete: boolean; planFrozen: boolean; planReady: boolean; invalidated: boolean; liveSource?: boolean; labels: Labels }) {
  const router = useRouter(), pause = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [saved, setSaved] = useState(false);
  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string, fallback = "") => { const value = form.get(name); return typeof value === "string" ? value : fallback; };
    setBusy(true); setError(null); setSaved(false);
    try {
      await apiJson("/api/v1/imports.reviewConflicts", { method: "POST", body: JSON.stringify({ id, graph: version, conflicts: [{ slug: text("slug"), resolution: text("resolution", "keep-existing"), renamedSlug: text("renamedSlug") }] }) });
      setSaved(true); router.refresh();
    } catch { setError(labels.failed); }
    finally { setBusy(false); }
  }
  async function advance(operation: Operation) {
    pause.current = false; setBusy(true); setError(null); setSaved(false);
    const targets: Record<Operation, string> = { index: "previewed", commit: "committed", reconcile: "reconciled", publish: "published", rollback: "rolled_back" };
    try {
      // Each request authenticates again and commits its own bounded receipt.
      // Pausing finishes the in-flight request; it never assumes cancellation.
      for (let phase = 0; phase < 600 && !pause.current; phase++) {
        const reply = await apiJson<Reply>(`/api/v1/imports.${operation === "index" ? "previewFromUpload" : operation}`, { method: "POST", body: JSON.stringify(operation === "index" ? { id, uploadId: upload?.uploadId } : { id, graph: version }) });
        if (reply.status === "failed") throw new Error("Source refused");
        setSaved(true);
        const counts = reply.counts && typeof reply.counts === "object" ? reply.counts as Record<string, unknown> : {};
        if (operation === "commit" && Number(counts.mediaFailed ?? 0) > 0) { setError(labels.failed); break; }
        if (reply.status === targets[operation]) break;
      }
    } catch { setError(labels.failed); }
    finally { setBusy(false); router.refresh(); }
  }
  const next: Operation | undefined = invalidated ? undefined : status === "discover" && upload && upload.received === upload.chunks ? "index" : status === "previewed" && indexComplete && planReady ? "commit" : status === "committed" ? "reconcile" : status === "reconciled" ? "publish" : undefined;
  const nextLabel = next === "index" ? labels.index : next === "commit" ? labels.commit : next === "reconcile" ? labels.reconcile : labels.publish;
  return <div className="grid min-w-0 gap-5">
    <p className="max-w-prose text-sm text-ink-muted">{labels.intro}</p>
    {error ? <p role="alert" className="text-sm font-medium text-danger">{error}</p> : null}
    {busy ? <p role="status" className="text-sm text-ink-muted">{labels.working}</p> : saved ? <p role="status" className="text-sm text-ink-muted">{labels.saved}</p> : null}
    <div className="flex flex-wrap gap-3">
      {next ? <Button type="button" disabled={busy} onClick={() => void advance(next)}>{nextLabel}</Button> : null}
      {busy ? <Button type="button" variant="quiet" onClick={() => { pause.current = true; }}>{labels.pause}</Button> : null}
      {status !== "rolled_back" ? <Button type="button" variant="danger" disabled={busy} onClick={() => void advance("rollback")}>{labels.rollback}</Button> : null}
    </div>
    {!invalidated && !planFrozen && indexComplete && status === "previewed" ? <form onSubmit={event => void review(event)} className="grid min-w-0 gap-3">
      <p className="text-sm text-ink-muted">{labels.reviewHint}</p>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="graph" value={JSON.stringify(version)} />
      <Field htmlFor="graph-conflict-slug" label={labels.slug} hint={labels.slugHint}><Input id="graph-conflict-slug" name="slug" disabled={busy} /></Field>
      <Field htmlFor="graph-conflict-resolution" label={labels.review}><Select id="graph-conflict-resolution" name="resolution" defaultValue="keep-existing" disabled={busy}>
        <option value="keep-existing">{labels.keep}</option><option value="replace">{labels.replace}</option><option value="rename">{labels.rename}</option>
      </Select></Field>
      <Field htmlFor="graph-conflict-renamed" label={labels.renamedSlug}><Input id="graph-conflict-renamed" name="renamedSlug" disabled={busy} /></Field>
      <Button type="submit" disabled={busy}>{labels.review}</Button>
    </form> : null}
    {!liveSource && !invalidated && ["discover", "previewed"].includes(status) ? <fieldset disabled={busy} className="grid min-w-0 gap-3">
      <legend className="sr-only">{labels.upload}</legend>
      <p className="text-sm text-ink-muted">{labels.restoreHint}</p><p className="text-sm text-ink-muted">{labels.limits}</p>
      <SourceUploadForm id={id} sourceKind={sourceKind} graph={version} labels={labels} />
    </fieldset> : null}
  </div>;
}
