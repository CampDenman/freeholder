// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.21: add photos or video to a post, comment or message, each with a
// description for people who cannot see it. Files go through the ordinary
// media upload; the form that holds this saves them.
"use client";
import { useState } from "react";

function csrf(): string {
  for (const part of document.cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "freeholder_csrf") return decodeURIComponent(rest.join("="));
  }
  return "";
}

type Labels = { add: string; describe: string; uploading: string; failed: string; remove: string };

export function MediaAttach({ id, labels, max = 4 }: { id: string; labels: Labels; max?: number }) {
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setState("busy");
    const added: { id: string; name: string }[] = [];
    for (const file of Array.from(list).slice(0, max - files.length)) {
      const data = new FormData();
      data.set("file", file);
      const response = await fetch("/api/media", { method: "POST", body: data, headers: { "x-csrf-token": csrf() } });
      const body = (await response.json().catch(() => null)) as { id?: string } | null;
      if (!response.ok || !body?.id) {
        setState("failed");
        return;
      }
      added.push({ id: body.id, name: file.name });
    }
    setFiles([...files, ...added]);
    setState("idle");
  }
  return (
    <div className="grid gap-2">
      {files.length < max ? (
        <div className="grid gap-1">
          <label className="text-sm font-medium" htmlFor={`${id}-files`}>{labels.add}</label>
          <input id={`${id}-files`} type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm,video/quicktime" onChange={(e) => void upload(e.target.files)} className="text-sm" />
        </div>
      ) : null}
      {state === "busy" ? <p className="text-sm text-ink-muted" role="status">{labels.uploading}</p> : null}
      {state === "failed" ? <p className="text-sm text-danger" role="alert">{labels.failed}</p> : null}
      {files.map((f, i) => (
        <div key={f.id} className="grid gap-1 rounded-md border border-rule p-2">
          <input type="hidden" name="attachment" value={f.id} />
          <label className="text-sm" htmlFor={`${id}-alt-${i}`}>{labels.describe} <span className="text-ink-muted">({f.name})</span></label>
          <div className="flex gap-2">
            <input id={`${id}-alt-${i}`} name={`alt:${f.id}`} maxLength={500} className="w-full rounded-md border border-rule-strong bg-field px-3 py-2 text-sm" />
            <button type="button" className="text-sm underline" onClick={() => setFiles(files.filter((x) => x.id !== f.id))}>{labels.remove}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Photos and video, shown only through the access-checked file route. */
export function Attachments({ items }: { items: { id: string; kind: "image" | "video"; altText: string; width: number | null; height: number | null }[] }) {
  if (items.length === 0) return null;
  return (
    <div className={`grid gap-2 ${items.length > 1 ? "grid-cols-2" : ""}`}>
      {items.map((a) =>
        a.kind === "image" ? (
          <img key={a.id} src={`/member-files/${a.id}?w=640`} alt={a.altText} width={a.width ?? undefined} height={a.height ?? undefined} loading="lazy" className="h-auto w-full rounded-md object-cover" />
        ) : (
          <video key={a.id} src={`/member-files/${a.id}`} controls preload="metadata" aria-label={a.altText || undefined} className="w-full rounded-md" />
        ),
      )}
    </div>
  );
}
