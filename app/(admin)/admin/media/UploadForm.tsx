// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
"use client";
// Uploading posts multipart straight to the API route rather than through a
// Server Action: actions serialize their arguments, and putting a 20 MB
// photograph through that is slower and needlessly memory-hungry. The route is
// the same service call either way.
import { useState } from "react";
import { UploadSimple, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Button, Callout, Field } from "@/ui/primitives";

/** The double-submit token the API expects on cookie-authenticated writes. */
function readCsrfToken(): string {
  for (const part of document.cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "freeholder_csrf") return decodeURIComponent(rest.join("="));
  }
  return "";
}

export function UploadForm({
  labels,
}: {
  labels: {
    file: string;
    fileHint: string;
    submit: string;
    pending: string;
    failed: string;
  };
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  return (
    <form
      className="grid gap-4 rounded-lg border border-rule bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        if (!(data.get("file") instanceof File)) return;

        setPending(true);
        setError(undefined);
        void (async () => {
          try {
            const response = await fetch("/api/media", {
              method: "POST",
              body: data,
              headers: { "x-csrf-token": readCsrfToken() },
            });
            if (!response.ok) {
              const body = (await response.json().catch(() => null)) as {
                error?: { message?: string };
              } | null;
              setError(body?.error?.message ?? labels.failed);
              return;
            }
            form.reset();
            // The library is server-rendered, so asking for it again is the
            // simplest correct refresh.
            window.location.reload();
          } finally {
            setPending(false);
          }
        })();
      }}
    >
      {error ? (
        <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
          {error}
        </Callout>
      ) : null}
      <Field label={labels.file} htmlFor="file" hint={labels.fileHint}>
        <input
          id="file"
          name="file"
          type="file"
          required
          className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
        />
      </Field>
      <div>
        <Button type="submit" disabled={pending}>
          <UploadSimple size={15} weight="bold" />
          {pending ? labels.pending : labels.submit}
        </Button>
      </div>
    </form>
  );
}
