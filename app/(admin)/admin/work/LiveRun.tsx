// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Pill } from "@/ui/primitives";
import { stopRunAction, tailRunAction } from "../../work-actions";

type Step = {
  id: string;
  seq: number;
  kind: string;
  serviceName: string | null;
  input: unknown;
  output: unknown;
  tokens: number;
  durationMs: number | null;
  error: string | null;
};

export function LiveRun({
  runId,
  live,
  initialSteps,
  labels,
}: {
  runId: string;
  live: boolean;
  initialSteps: Step[];
  labels: {
    live: string;
    stopped: string;
    stop: string;
    empty: string;
    tokens: string;
    step: Record<string, string>;
  };
}) {
  const [steps, setSteps] = useState(initialSteps);
  const [isLive, setIsLive] = useState(live);
  const afterSeq = useRef(initialSteps.at(-1)?.seq ?? 0);

  useEffect(() => {
    if (!isLive) return;
    let cancelled = false;
    const tick = async () => {
      const next = await tailRunAction(runId, afterSeq.current);
      if (cancelled || !next) return;
      if (next.steps.length) {
        afterSeq.current = next.steps.at(-1)?.seq ?? afterSeq.current;
        setSteps((current) => [...current, ...(next.steps as Step[])]);
      }
      setIsLive(next.live);
    };
    const timer = window.setInterval(() => {
      void tick();
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isLive, runId]);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={isLive ? "accent" : "neutral"}>{isLive ? labels.live : labels.stopped}</Pill>
        {isLive ? (
          <form action={stopRunAction}>
            <input type="hidden" name="runId" value={runId} />
            <Button type="submit" variant="danger">
              {labels.stop}
            </Button>
          </form>
        ) : null}
      </div>
      {steps.length === 0 ? (
        <p className="text-sm text-ink-muted">{labels.empty}</p>
      ) : (
        <ol className="grid list-none gap-2 p-0">
          {steps.map((step) => (
            <li key={step.id} className="rounded-md border border-rule px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-ink-muted">{step.seq}</span>
                <Pill tone="neutral">{labels.step[step.kind] ?? step.kind}</Pill>
                {step.serviceName ? (
                  <span className="font-mono text-xs">{step.serviceName}</span>
                ) : null}
                {step.tokens > 0 ? (
                  <span className="text-xs text-ink-muted">
                    {labels.tokens}: {step.tokens}
                  </span>
                ) : null}
              </div>
              {step.error ? <p className="mt-1 text-danger">{step.error}</p> : null}
              {step.input != null ? (
                <pre className="mt-2 overflow-x-auto font-mono text-xs text-ink-muted">
                  {JSON.stringify(step.input, null, 2)}
                </pre>
              ) : null}
              {step.output != null ? (
                <pre className="mt-2 overflow-x-auto font-mono text-xs text-ink-muted">
                  {JSON.stringify(step.output, null, 2)}
                </pre>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
