// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// A form's file question (C3.38), the one part of a public form that needs
// JavaScript.
//
// The file never travels with the form post. Choosing it sends it through the
// same resumable media pipeline the library uses — reserved as a private form
// upload, sniffed, scanned — and the form carries only the asset id that came
// back, in a hidden input. `forms.submit` then checks that the asset is this
// person's own upload of an accepted kind and size before attaching it.
//
// While an upload is running, or after it failed, the file input carries a
// custom validity message, so the browser's own constraint validation stops
// the form being sent without the file and says why — no second error system.
// Without JavaScript nothing uploads; the hint under the label says so, and a
// required question is refused by the server with its usual message.
import { useEffect, useRef, useState } from "react";
import { uploadMediaFileWithFacts } from "../../../app/(admin)/admin/media/upload-client";

export interface FileFieldCopy {
  /** "Uploading… {percent}%" */
  uploading: string;
  /** "Uploaded: {filename}" */
  uploaded: string;
  /** "The upload failed: {message}" */
  failed: string;
  /** "That file is larger than {mb} MB." */
  tooLarge: string;
  /** "Choose {kinds}." — the file is not a kind this question accepts. */
  wrongType: string;
  wait: string;
  remove: string;
}

type State =
  | { kind: "idle" }
  | { kind: "uploading"; percent: number }
  | { kind: "done"; assetId: string; filename: string }
  | { kind: "failed"; message: string };

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

export function FileField({
  id,
  name,
  required,
  accept,
  maxBytes,
  describedBy,
  invalid,
  copy,
}: {
  id: string;
  name: string;
  required: boolean;
  /** The `accept` attribute: extensions and MIME types the field allows. */
  accept: string;
  maxBytes: number;
  describedBy?: string;
  invalid?: boolean;
  copy: FileFieldCopy;
}) {
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    const element = input.current;
    if (!element) return;
    element.setCustomValidity(
      state.kind === "uploading"
        ? copy.wait
        : state.kind === "failed"
          ? fill(copy.failed, { message: state.message })
          : "",
    );
  }, [state, copy]);

  useEffect(() => () => controller.current?.abort(), []);

  async function choose(file: File | undefined) {
    controller.current?.abort();
    if (!file) {
      setState({ kind: "idle" });
      return;
    }
    // The picker's filter is advisory (any phone offers "all files"), so the
    // kind is checked here for a clear message, and again by the server's
    // sniffing of the bytes, which is the check that counts.
    const allowed = accept.split(",");
    const extension = file.name.includes(".")
      ? `.${file.name.split(".").pop()!.toLowerCase()}`
      : "";
    if (!allowed.includes(file.type) && !allowed.includes(extension)) {
      setState({ kind: "failed", message: copy.wrongType });
      return;
    }
    if (file.size > maxBytes) {
      setState({
        kind: "failed",
        message: fill(copy.tooLarge, { mb: Math.floor(maxBytes / 1024 / 1024) }),
      });
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setState({ kind: "uploading", percent: 0 });
    try {
      const result = await uploadMediaFileWithFacts(file, {}, {
        signal: abort.signal,
        purpose: "form",
        onProgress: (percent) => setState({ kind: "uploading", percent }),
      });
      if (abort.signal.aborted) return;
      if (!result.assetId) throw new Error(copy.wait);
      setState({ kind: "done", assetId: result.assetId, filename: file.name });
    } catch (error) {
      if (abort.signal.aborted) return;
      setState({
        kind: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function clear() {
    controller.current?.abort();
    if (input.current) input.current.value = "";
    setState({ kind: "idle" });
    input.current?.focus();
  }

  const statusId = `${id}-status`;
  return (
    <>
      <input
        ref={input}
        id={id}
        type="file"
        accept={accept}
        required={required}
        aria-describedby={[describedBy, statusId].filter(Boolean).join(" ")}
        aria-invalid={invalid || state.kind === "failed" ? true : undefined}
        onChange={(event) => void choose(event.target.files?.[0])}
        className="w-full rounded-md border border-rule-strong bg-field px-3 py-2 text-base text-ink file:me-3 file:rounded-md file:border-0 file:bg-accent-soft file:px-3 file:py-1 file:text-sm file:font-semibold file:text-accent"
      />
      {/* Only the asset id is posted, never the file or a URL. */}
      <input type="hidden" name={name} value={state.kind === "done" ? state.assetId : ""} />
      <p
        id={statusId}
        role="status"
        aria-live="polite"
        className={
          state.kind === "failed" ? "text-xs text-danger" : "text-xs text-ink-muted"
        }
      >
        {state.kind === "uploading"
          ? fill(copy.uploading, { percent: state.percent })
          : state.kind === "done"
            ? fill(copy.uploaded, { filename: state.filename })
            : state.kind === "failed"
              ? fill(copy.failed, { message: state.message })
              : null}
      </p>
      {state.kind === "done" || state.kind === "failed" ? (
        <button
          type="button"
          onClick={clear}
          className="w-fit rounded-md border border-rule px-3 py-1.5 text-xs font-medium text-ink"
        >
          {copy.remove}
        </button>
      ) : null}
    </>
  );
}
