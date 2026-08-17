// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// Copy the current page. Channel links stay server-rendered (C2.08, §34).
import { useState } from "react";

export function ShareCopyButton({
  url,
  label,
  copiedLabel,
}: {
  url: string;
  label: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(url).then(() => setCopied(true));
      }}
      className="rounded-md border border-rule px-3 py-1.5 text-sm font-medium text-ink"
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
