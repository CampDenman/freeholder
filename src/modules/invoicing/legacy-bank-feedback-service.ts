// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: exact verified callback facts commit before applying policy.
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { defineService, ServiceError } from "@/core/service";
import { env } from "@/core/env";
import { legacyFeedbackVerificationKeys } from "./legacy-bank-feedback-store";
import { queueOriginalMerchantRefundRepair } from "./merchant-refund-privacy-repair";
import { legacyBankFeedback } from "./legacy-bank-feedback-schema";
import { normalizeLegacyBankFeedback, signLegacyBankFeedback, verifyLegacyBankFeedback } from "./legacy-bank-feedback-proof";
import { merchantTaxDigest } from "./merchant-tax-store";

export const retainLegacyBankFeedback = defineService({
  name: "invoicing.retainLegacyBankFeedback", summary: "Commit authentic observed legacy bank feedback before later ownership or money policy, retaining unassigned actual resources without inventing history.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", auditInputFields: ["provider"],
  input: z.object({ provider: z.literal("stripe"), event: z.record(z.string(), z.unknown()), rawBodySha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(), receivedAt: z.string().datetime().nullable() }).strict(),
  output: z.object({ feedbackId: z.uuid(), conflict: z.boolean() }),
  handler: async (input, ctx) => {
    const [ready] = await ctx.tx.execute<{ ready: boolean }>(sql`select exists(select 1 from pg_trigger where tgrelid=to_regclass('public.legacy_bank_feedback') and tgname='legacy_bank_feedback_guard' and tgenabled in ('O','A')) ready`);
    if (!ready?.ready) throw new ServiceError("conflict", "Install the complete guarded legacy raw-feedback receipt before accepting its facts.");
    const evidence = normalizeLegacyBankFeedback(input.event, { rawBodySha256: input.rawBodySha256, receivedAt: input.receivedAt }), evidenceDigest = merchantTaxDigest(evidence);
    const originalKey = merchantTaxDigest({ kind: "original-legacy-bank-feedback-v1", evidenceDigest });
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`legacy-bank-feedback:${originalKey}`}))`);
    const [prior] = await ctx.tx.select().from(legacyBankFeedback).where(eq(legacyBankFeedback.captureKey, originalKey));
    if (prior && verifyLegacyBankFeedback(prior, legacyFeedbackVerificationKeys())) return { feedbackId: prior.id, conflict: false };
    const id = randomUUID(), createdAt = new Date(), configured = env(), key = configured.CREDENTIAL_KEY ?? configured.SESSION_SECRET;
    if (!key) throw new ServiceError("conflict", "Restore the original bank-feedback evidence key before retaining its raw facts.");
    const conflict = Boolean(prior), captureKey = prior ? merchantTaxDigest({ originalKey, corruptReceiptId: prior.id, actualOccurrenceId: id }) : originalKey;
    // A corrupt prior row is never rewritten or signed retroactively. Retain
    // this actual callback occurrence first, then report its repair debt.
    const authentication = signLegacyBankFeedback({ id, captureKey, evidenceDigest, createdAt }, key);
    await ctx.tx.execute(sql`select set_config('freeholder.legacy_bank_feedback_v1','1',true)`);
    await ctx.tx.insert(legacyBankFeedback).values({ id, captureKey, evidenceDigest, authentication, evidence, createdAt });
    queueOriginalMerchantRefundRepair(ctx, { kind: "legacy_bank_feedback", id });
    return { feedbackId: id, conflict };
  },
});
export default [retainLegacyBankFeedback];
