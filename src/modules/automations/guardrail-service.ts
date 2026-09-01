// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Asking the guardrails from outside the runtime (MASTER.md §4.17, C9.03).
//
// The runtime asks `mayProceed` before every acting step. This exposes the
// same question as a service, for two reasons that are worth stating.
//
// An owner about to switch an automation on wants to know *now* whether its
// steps would be allowed, rather than discovering it from a run that quietly
// parked for approval. And a decision with this much consequence should be
// answerable on demand rather than only inferable from its effects — "why did
// nothing happen" is the question this feature will be asked most often.
import { z } from "zod";
import { row, uuid as uuidSchema } from "@/core/contract";
import { defineService, ServiceError } from "@/core/service";
import { automationVerb } from "@/core/automations/verbs";
import { contacts } from "@/core/contacts/schema";
import { eq } from "drizzle-orm";
import { mayProceed } from "./guardrails";

export const checkGuardrails = defineService({
  name: "automations.checkGuardrails",
  summary: "Would this action be allowed for this person, right now?",
  kind: "query",
  permission: "scoped",
  input: z.object({
    verb: z.string().trim().min(1),
    contactId: uuidSchema.nullish(),
    autonomyCeiling: z.enum(["suggest", "approve", "autonomous"]).nullish(),
    inputTrust: z.enum(["owner", "system", "untrusted"]).default("system"),
    intent: z.enum(["transactional", "marketing"]).default("transactional"),
    costMinor: z.number().int().min(0).default(0),
    budgetRemainingMinor: z.number().int().min(0).nullish(),
  }),
  output: row({
    decision: z.enum(["proceed", "approve", "refuse", "defer"]),
    reason: z.string().nullable(),
    until: z.date().nullable(),
  }),
  handler: async (input, ctx) => {
    const verb = automationVerb(input.verb);
    if (!verb) throw new ServiceError("not_found", `Nothing can do "${input.verb}".`);

    const [person] = input.contactId
      ? await ctx.tx
          .select({ phone: contacts.phone })
          .from(contacts)
          .where(eq(contacts.id, input.contactId))
      : [];

    const verdict = await mayProceed(ctx, {
      verb,
      contactId: input.contactId ?? null,
      phone: person?.phone ?? null,
      autonomyCeiling: input.autonomyCeiling ?? null,
      inputTrust: input.inputTrust,
      intent: input.intent,
      costMinor: input.costMinor,
      budgetRemainingMinor: input.budgetRemainingMinor ?? null,
    });

    return {
      decision: verdict.decision,
      reason: "reason" in verdict ? verdict.reason : null,
      until: verdict.decision === "defer" ? verdict.until : null,
    };
  },
});
