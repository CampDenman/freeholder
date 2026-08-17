// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// Heartbeat so other editors can see who is on this page (C2.03).
import { useEffect, useState } from "react";
import {
  heartbeatPresenceAction,
  leavePresenceAction,
} from "../../../cms-actions";

export function PagePresence({
  pageId,
  self,
  labels,
}: {
  pageId: string;
  self: string;
  labels: {
    alone: string;
    others: string;
    editing: string;
  };
}) {
  const [actors, setActors] = useState<{ actor: string; editing: boolean }[]>([]);

  useEffect(() => {
    let cancelled = false;
    const pulse = async (editing: boolean) => {
      const result = await heartbeatPresenceAction(pageId, editing);
      if (!cancelled && result.actors) setActors(result.actors);
    };
    void pulse(true);
    const timer = window.setInterval(() => void pulse(true), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      void leavePresenceAction(pageId);
    };
  }, [pageId]);

  const others = actors.filter((row) => row.actor !== self);
  if (others.length === 0) {
    return <p className="text-sm text-ink-muted">{labels.alone}</p>;
  }
  return (
    <p className="text-sm text-ink">
      {labels.others}{" "}
      {others.map((row) => (
        <span key={row.actor} className="me-2 font-mono text-xs">
          {row.actor}
          {row.editing ? ` (${labels.editing})` : ""}
        </span>
      ))}
    </p>
  );
}
