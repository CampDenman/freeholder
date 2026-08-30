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
import { defineService, ServiceError } from "@/core/service";
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
    const [program] = await ctx.tx
      .select()
      .from(affiliatePrograms)
      .where(eq(affiliatePrograms.id, input.programId));
    if (!program) throw new ServiceError("not_found", "There is no such programme.");

    const rows = await ctx.tx
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
          eq(attributionTouches.contactId, input.contactId),
          eq(affiliateCodes.programId, input.programId),
        ),
      );

    // Self-referral, refused here rather than watched for later. Somebody
    // using their own code is not a referral, and the cheapest moment to say
    // so is before the number reaches an invoice.
    const eligible = rows.filter((touch) => touch.referrerContactId !== input.contactId);

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
  },
});