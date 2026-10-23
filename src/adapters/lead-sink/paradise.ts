// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Paradise Modern as one lead-sink adapter (C3.34): its lead collection API.
import { ParadiseRequestError, paradiseRequest } from "@/adapters/paradise/http";
import { LeadSinkRetryableError, type LeadCopy } from "./types";

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

export async function sendLeadToParadise(lead: LeadCopy): Promise<void> {
  try {
    await paradiseRequest("/api/collect/lead", { body: paradiseLeadBody(lead) });
  } catch (error) {
    if (error instanceof ParadiseRequestError && error.retryable) {
      throw new LeadSinkRetryableError(error.message);
    }
    throw error;
  }
}
