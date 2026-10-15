// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.20: upload images through the ordinary media pipeline, then hand their
// ids to the surrounding form, which a server action saves.
"use client";
import { useEffect, useRef, useState } from "react";

function csrf(): string {
  for (const part of document.cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "freeholder_csrf") return decodeURIComponent(rest.join("="));
  }
  return "";
}

export function ImageUpload({ name, label, multiple = false, busyLabel, failedLabel }: { name: string; label: string; multiple?: boolean; busyLabel: string; failedLabel: string }) {
  const [ids, setIds] = useState<string[]>([]);
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const [submit, setSubmit] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Submit only after the hidden id inputs exist in the form.
  useEffect(() => {
    if (!submit) return;
    setSubmit(false);
    input.current?.form?.requestSubmit();
  }, [submit, ids]);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setState("busy");
    const uploaded: string[] = [];
    for (const file of Array.from(files)) {
      const data = new FormData();
      data.set("file", file);
      const response = await fetch("/api/media", { method: "POST", body: data, headers: { "x-csrf-token": csrf() } });
      const body = (await response.json().catch(() => null)) as { id?: string } | null;
      if (!response.ok || !body?.id) {
        setState("failed");
        return;
      }
      uploaded.push(body.id);
    }
    setIds(multiple ? [...ids, ...uploaded] : uploaded.slice(0, 1));
    setState("idle");
    if (!multiple) setSubmit(true);
  }
  return (
    <div className="grid gap-1">
      <label className="text-sm font-medium" htmlFor={`${name}-file`}>{label}</label>
      <input ref={input} id={`${name}-file`} type="file" accept="image/png,image/jpeg,image/webp,image/avif" multiple={multiple} onChange={(e) => void upload(e.target.files)} className="text-sm" />
      {ids.map((id) => <input key={id} type="hidden" name={name} value={id} />)}
      {state === "busy" ? <p className="text-sm text-ink-muted" role="status">{busyLabel}</p> : null}
      {state === "failed" ? <p className="text-sm text-danger" role="alert">{failedLabel}</p> : null}
    </div>
  );
}
