// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// The Web Share API, offered only where it exists (MASTER.md §34).
//
// §34 asks for "native Web Share API on mobile, channel links on desktop". The
// honest way to tell those apart is to ask the browser rather than to guess
// from a user-agent string, so this renders nothing at all until it has run
// and found `navigator.share`. Everything the visitor needs — the link, the
// attribution text, the channel buttons — is already on the page without it.
//
// The link was minted on the server before this component ever mounted, so the
// share is counted whether or not the visitor completes the system dialog.
// That is the right trade: a share sheet gives no callback worth trusting, and
// counting the intent is closer to the truth than counting nothing.
import { useEffect, useState } from "react";

export function NativeShare({
  url,
  text,
  label,
}: {
  url: string;
  text: string;
  label: string;
}) {
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.share({ title: text, text, url }).catch(() => {
          // A visitor who closes the sheet is not an error worth reporting.
        });
      }}
      className="inline-flex items-center justify-center rounded-md border border-rule bg-surface px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface-muted"
    >
      {label}
    </button>
  );
}
