// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Which first-win flow the admin overview leads with.
//
// It used to be "the flow for your role, else the first one alphabetically",
// and an account with no role-specific flow (the public playground, a custom
// role) was shown the bookkeeper's "Prepare your reporting routine" — alerts
// and digest schedules — as its first win on a photography site. A first win
// should be something the person can *see* on their site, and something they
// have not already done.
import type { GuidanceFlowView } from "@/core/guidance/service";

/**
 * Flows ranked by how visible their first result is. Publishing a page or
 * adding a customer changes what the owner sees; alert routines and team
 * invitations matter later. Flows not listed (plugins) rank after the
 * visible ones and before the internal routines.
 */
export const FIRST_WIN_ORDER = [
  "core.owner-first-win",
  "core.editor-first-win",
  "core.service-provider-first-win",
  "core.customer-first-win",
  "*",
  "core.administrator-first-win",
  "core.bookkeeper-first-win",
] as const;

function visibility(flow: GuidanceFlowView): number {
  const index = FIRST_WIN_ORDER.indexOf(flow.key as (typeof FIRST_WIN_ORDER)[number]);
  return index >= 0 ? index : FIRST_WIN_ORDER.indexOf("*");
}

/** In progress beats not started; finished or skipped flows come last. */
function progress(flow: GuidanceFlowView): number {
  if (flow.state === "active") return 0;
  if (flow.state === "not_started") return 1;
  if (flow.state === "dismissed") return 2;
  return 3;
}

export function chooseFirstWin(
  flows: readonly GuidanceFlowView[],
): GuidanceFlowView | undefined {
  return [...flows].sort(
    (a, b) =>
      // Something still to do always outranks something done or skipped.
      Math.min(progress(a), 2) - Math.min(progress(b), 2) ||
      // Among those, the curriculum written for this role…
      Number(b.audienceMatch) - Number(a.audienceMatch) ||
      // …then the flow whose result shows on the site soonest.
      visibility(a) - visibility(b) ||
      progress(a) - progress(b),
  )[0];
}
