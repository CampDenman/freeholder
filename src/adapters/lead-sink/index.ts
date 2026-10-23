// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The lead-sink category (C3.34, MASTER.md §12).
//
// An owner who keeps leads in an outside CRM can have accepted form
// submissions copied there: `LEAD_SINK_PROVIDER`, default `none`, a switch of
// its own (screening never turns it on). The copy is made after commit by an
// outbox listener, so the submission is always kept in Freeholder first and a
// provider outage only delays the copy. Quarantined submissions are never
// copied: suspected spam is nobody's lead.
import { env } from "@/core/env";
import { sendLeadToParadise } from "./paradise";
import type { LeadSinkAdapter } from "./types";

export { LeadSinkRetryableError, type LeadCopy, type LeadSinkAdapter } from "./types";

export { LEAD_SINK_PROVIDERS, type LeadSinkProviderId } from "./types";

/** The configured adapter, or null when the category is off. */
export function leadSink(): LeadSinkAdapter | null {
  const current = env();
  if (current.FREEHOLDER_PLAYGROUND === "1") return null;
  if (current.LEAD_SINK_PROVIDER !== "paradise") return null;
  if (!current.PARADISEMODERN_API_KEY) return null;
  return { id: "paradise", displayName: "Paradise Modern", send: sendLeadToParadise };
}
