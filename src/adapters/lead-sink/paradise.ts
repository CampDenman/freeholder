// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Paradise Modern as one lead-sink adapter (C3.34): its lead collection API.
import { paradiseRequest } from "@/adapters/paradise/http";
import type { LeadCopy } from "./types";

export function paradiseLeadBody(lead: LeadCopy): Record<string, unknown> {
  return {
    name: lead.name.slice(0, 500),
    ...(lead.email ? { email: lead.email } : {}),
    ...(lead.phone ? { phone: lead.phone } : {}),
    ...(lead.message ? { message: lead.message.slice(0, 5000) } : {}),
    source: `form:${lead.formSlug}`.slice(0, 200),
    externalId: lead.submissionId,
    fields: lead.answers,
    ...(lead.pageUrl ? { referer: lead.pageUrl.slice(0, 2000) } : {}),
  };
}

/** Throws the helper's error, which carries a status and code, never the body. */
export async function sendLeadToParadise(lead: LeadCopy): Promise<void> {
  await paradiseRequest("/api/collect/lead", { body: paradiseLeadBody(lead) });
}
