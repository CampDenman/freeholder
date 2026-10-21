// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.07: a member hears a ringing call on any member-facing page.
"use client";
import { useEffect, useState } from "react";
import { answer, ringingCalls } from "./actions";

type Ring = { id: string; media: "voice" | "video"; other: { displayName: string } };

export function IncomingCall({ labels }: { labels: { incomingVoice: string; incomingVideo: string; answer: string; decline: string } }) {
  const [ring, setRing] = useState<Ring | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      if (stopped) return;
      try {
        const calls = (await ringingCalls()) as Ring[];
        setRing(calls[0] ?? null);
      } catch {
        // Try again on the next tick.
      }
      timer = setTimeout(() => void poll(), 4000);
    }
    void poll();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, []);
  if (!ring) return null;
  const text = (ring.media === "video" ? labels.incomingVideo : labels.incomingVoice).replace("{name}", ring.other.displayName);
  return (
    <div role="alertdialog" aria-label={text} className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md flex-wrap items-center justify-between gap-3 rounded-lg border border-rule-strong bg-surface p-4 shadow-lg">
      <p className="font-semibold">{text}</p>
      <span className="flex gap-2">
        <a className="rounded-md bg-accent px-3 py-2 text-on-accent" href={`/call/${ring.id}`}>{labels.answer}</a>
        <button type="button" className="rounded-md border border-rule-strong px-3 py-2" onClick={() => { void answer(ring.id, false).then(() => setRing(null)); }}>
          {labels.decline}
        </button>
      </span>
    </div>
  );
}
