// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// MRC observation for a served fill (MASTER.md §4.16, C9.19).
import { useEffect, useRef } from "react";
import { VIEWABLE_MS, VIEWABLE_PIXEL_RATIO } from "./viewability";

export function AdBeacon({
  creativeId,
  slotId,
  children,
}: {
  creativeId: string;
  slotId: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const impressed = useRef(false);
  const viewable = useRef(false);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    const send = (kind: "impression" | "viewable") => {
      void fetch("/api/ads/view", {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          creativeId,
          slotId,
          path: window.location.pathname,
        }),
      });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting && !impressed.current) {
          impressed.current = true;
          send("impression");
        }
        if (entry.intersectionRatio >= VIEWABLE_PIXEL_RATIO && !viewable.current) {
          if (hold.current) return;
          hold.current = setTimeout(() => {
            hold.current = null;
            if (viewable.current) return;
            viewable.current = true;
            send("viewable");
          }, VIEWABLE_MS);
        } else if (entry.intersectionRatio < VIEWABLE_PIXEL_RATIO && hold.current) {
          clearTimeout(hold.current);
          hold.current = null;
        }
      },
      { threshold: [0, VIEWABLE_PIXEL_RATIO] },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (hold.current) clearTimeout(hold.current);
    };
  }, [creativeId, slotId]);

  return (
    <div ref={ref} data-ad-creative={creativeId} data-ad-slot={slotId}>
      {children}
    </div>
  );
}
