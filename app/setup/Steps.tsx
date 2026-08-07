// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
import { Check } from "@phosphor-icons/react/dist/ssr";
import { cx } from "@/ui/primitives";
import { getT } from "../i18n";

const STEP_KEYS = [
  "setup.steps.owner",
  "setup.steps.business",
  "setup.steps.location",
  "setup.steps.done",
] as const;

/** Where you are in the flow — position carries real information. */
export async function Steps({ current }: { current: 0 | 1 | 2 | 3 }) {
  const t = await getT();
  const STEPS = STEP_KEYS.map((key) => t(key));

  return (
    <ol className="mb-8 flex flex-wrap items-center gap-x-3 gap-y-2 p-0">
      {STEPS.map((label, i) => {
        const done = i < current;
        const here = i === current;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cx(
                "flex size-5 items-center justify-center rounded-full font-mono text-[10px] font-bold",
                done && "bg-success-soft text-success",
                here && "bg-accent text-on-accent",
                !done && !here && "bg-surface-muted text-ink-muted",
              )}
            >
              {done ? <Check size={11} weight="bold" /> : i + 1}
            </span>
            <span
              className={cx(
                "text-xs",
                here ? "font-semibold text-ink" : "text-ink-muted",
              )}
              aria-current={here ? "step" : undefined}
            >
              {label}
            </span>
            {i < STEPS.length - 1 ? (
              <span aria-hidden="true" className="ms-1 h-px w-6 bg-rule" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
