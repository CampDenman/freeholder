// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";

import { useState } from "react";
import { createPreviewLinkAction } from "../../../cms-actions";

export function CopyPreviewLink({
  pageId,
  createLabel,
  copiedLabel,
}: {
  pageId: string;
  createLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | undefined>();

  return (
    <form
      action={async (form) => {
        const result = await createPreviewLinkAction(form);
        if (result.error || !result.path) {
          setError(result.error ?? "Could not create a link.");
          return;
        }
        const url = `${window.location.origin}${result.path}`;
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setError(undefined);
      }}
      className="flex flex-wrap items-center gap-3"
    >
      <input type="hidden" name="id" value={pageId} />
      <button
        type="submit"
        className="rounded-md border border-rule px-3 py-1.5 text-sm font-medium text-ink"
      >
        {copied ? copiedLabel : createLabel}
      </button>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </form>
  );
}
