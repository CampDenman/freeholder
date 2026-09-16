// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Who introduced this customer (MASTER.md §4.3, §4.13, C9.09).
//
// This lives in its own file rather than beside the rest of the module's
// services because two things need it and they must not need each other:
// `service.ts` presents it to the owner, and `commission-service.ts` divides
// real money by it (C9.10). Importing it from `service.ts` made those two
// files a cycle, and a cycle in a services module is not a style problem —
// boot reads the default export array while one half is still undefined, and
// the module fails to wire with an error that names nothing useful.
//
// Both callers reading the *same* service is the point. What the owner's
// attribution report shows and what an affiliate is actually paid cannot drift
// apart if there is only one answer to compute.
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { row, uuid as uuidSchema } from "@/core/contract";
import { defineService, ServiceError, type Tx } from "@/core/service";
import { affiliateCodes, affiliatePrograms, attributionTouches } from "./schema";
import { creditsFor, withinWindow } from "./attribution";

const creditRow = row({
  codeId: uuidSchema,
  code: z.string(),
  referrerContactId: uuidSchema,
  share: z.number(),
});

/**
 * Who introduced this customer, under the programme's own model.
 *
 * Computed, never stored. The touches are the record and the model is a
 * setting, so this is the one place the two meet — which is what lets an owner
 * change the model and get a different, correct answer about the same past.
 */
export type Attribution = {
  model: "last_touch" | "first_touch" | "position_based";
  cookieWindowDays: number;
  touches: number;
  credits: { codeId: string; code: string; referrerContactId: string; share: number }[];
};

/**
 * The computation, against a transaction.
 *
 * Split out from the service so the commission listener can reach it without
 * being a mutation service itself. That is not a style preference: every
 * mutation writes an `audit_log` row, and a listener that fires on every
 * `contact.created` would put "referrals reacted to something" at the top of
 * the owner's activity feed on a site that has no referral programme at all.
 * Loyalty's listener avoids the same trap the same way.
 */
export async function attributionOf(
  tx: Tx,
  contactId: string,
  programId: string,
): Promise<Attribution | null> {
  const [program] = await tx
    .select()
    .from(affiliatePrograms)
    .where(eq(affiliatePrograms.id, programId));
  if (!program) return null;

  const rows = await tx
    .select({
      codeId: attributionTouches.codeId,
      at: attributionTouches.at,
      referrerContactId: affiliateCodes.contactId,
      code: affiliateCodes.code,
    })
    .from(attributionTouches)
    .innerJoin(affiliateCodes, eq(affiliateCodes.id, attributionTouches.codeId))
    .where(
      and(
        eq(attributionTouches.contactId, contactId),
        eq(affiliateCodes.programId, programId),
      ),
    );

  // Self-referral, refused here rather than watched for later. Somebody using
  // their own code is not a referral, and the cheapest moment to say so is
  // before the number reaches an invoice.
  const eligible = rows.filter((touch) => touch.referrerContactId !== contactId);

  const inWindow = withinWindow(
    eligible.map((touch) => ({ codeId: touch.codeId, at: touch.at })),
    program.cookieWindowDays,
    new Date(),
  );
  const credits = creditsFor(program.attributionModel, inWindow);
  const byCode = new Map(eligible.map((touch) => [touch.codeId, touch]));

  return {
    model: program.attributionModel,
    cookieWindowDays: program.cookieWindowDays,
    touches: inWindow.length,
    credits: credits.map((credit) => ({
      codeId: credit.codeId,
      code: byCode.get(credit.codeId)!.code,
      referrerContactId: byCode.get(credit.codeId)!.referrerContactId,
      share: credit.share,
    })),
  };
}

/**
 * Who introduced this customer, under the programme's own model.
 *
 * Computed, never stored. The touches are the record and the model is a
 * setting, so this is the one place the two meet — which is what lets an owner
 * change the model and get a different, correct answer about the same past.
 *
 * The owner's report and the money both read `attributionOf`, so what a
 * report shows and what an affiliate is paid cannot drift apart.
 */
export const attributionFor = defineService({
  name: "referrals.attributionFor",
  summary: "Which referrers earned a share of this customer, and how much.",
  kind: "query",
  permission: "scoped",
  input: z.object({ contactId: uuidSchema, programId: uuidSchema }),
  output: row({
    model: z.enum(["last_touch", "first_touch", "position_based"]),
    cookieWindowDays: z.number().int(),
    touches: z.number().int(),
    credits: z.array(creditRow),
  }),
  handler: async (input, ctx) => {
    const found = await attributionOf(ctx.tx, input.contactId, input.programId);
    if (!found) throw new ServiceError("not_found", "There is no such programme.");
    return found;
  },
});
