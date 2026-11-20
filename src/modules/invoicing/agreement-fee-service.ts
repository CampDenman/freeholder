// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: shared bounded original commission review and attested remittance.
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { actorString, defineService, ServiceError, type ServiceContext } from "@/core/service";
import { agreementFeeRemittances } from "./agreement-fee-schema";
import { agreementFeeWriter } from "./agreement-fee-store";
import { originalAgreementFeeState } from "./agreement-fee-state";
import { invoiceCreditApplications, invoiceCreditFunding, invoiceCreditReservations } from "./credit-application-schema";
import { merchantTaxDigest } from "./merchant-tax-store";
import { payments } from "./schema";
const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const publicState = z.object({ invoiceId: z.uuid(), currency: z.string(), eligible: z.boolean(), expectedReceivableMinor: minor,
  owedMinor: minor.nullable(), recordedMinor: minor.nullable(), returnDueMinor: minor.nullable(), originalSourceExcessMinor: minor.nullable(), reviewRequired: z.boolean(), pending: z.boolean() });

export async function lockAgreementFeeSources(ctx: ServiceContext, invoiceId: string) {
  const cash = await ctx.tx.select({ id: payments.id }).from(payments).where(eq(payments.invoiceId, invoiceId)).limit(1001);
  const credit = await ctx.tx.select({ id: invoiceCreditFunding.sourcePaymentId }).from(invoiceCreditApplications)
    .innerJoin(invoiceCreditReservations, eq(invoiceCreditReservations.id, invoiceCreditApplications.reservationId))
    .innerJoin(invoiceCreditFunding, eq(invoiceCreditFunding.id, invoiceCreditReservations.fundingId)).where(eq(invoiceCreditApplications.invoiceId, invoiceId)).limit(1001);
  if (cash.length + credit.length > 1000) throw new ServiceError("conflict", "Restore the bounded complete original cash/noncash commission inventory before another remittance.");
  for (const id of [...new Set([...cash, ...credit].map(row => row.id))].sort()) await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payment:${id}`}))`);
  await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice:${invoiceId}`}))`);
  await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`agreement-fee-duty:${invoiceId}`}))`);
}
export const reviewAgreementFee = defineService({ name: "invoicing.reviewAgreementFee", summary: "Review the exact original target's planned and retained commission duty separately from actual attested remittances and fee returns.",
  kind: "query", permission: "scoped", input: z.object({ invoiceId: z.uuid() }), output: publicState.extend({
    receipts: z.array(z.object({ id: z.uuid(), amountMinor: minor, direction: z.enum(["remitted", "returned"]), originalRemittanceId: z.uuid().nullable(), recordedBy: z.string(), createdAt: z.date() })).max(1000) }),
  handler: async ({ invoiceId }, ctx) => {
    const state = await originalAgreementFeeState(ctx, invoiceId); if (!state) throw new ServiceError("not_found", "This invoice has no accepted original commission assignment.");
    return { ...publicState.parse(state), receipts: state.witness.receipts.map(row => ({ id: row.id, amountMinor: row.amountMinor, direction: row.direction,
      originalRemittanceId: row.originalRemittanceId, recordedBy: row.recordedBy, createdAt: row.createdAt })) };
  },
});
export const recordAgreementFeeRemittance = defineService({ name: "invoicing.recordAgreementFeeRemittance", summary: "Record an actual external remittance or exact original receipt return against a bounded retained commission receivable; recorded money is not independently bank verified.",
  kind: "mutation", permission: "scoped", stepUp: true, writeClass: "money", auditInputFields: ["invoiceId", "amountMinor", "direction", "originalRemittanceId"],
  input: z.object({ invoiceId: z.uuid(), amountMinor: minor.positive(), direction: z.enum(["remitted", "returned"]).default("remitted"), originalRemittanceId: z.uuid().optional(),
    idempotencyKey: z.string().min(1).max(200), reference: z.string().min(1).max(300), evidence: z.string().min(3).max(1000) })
    .refine(value => value.direction === "returned" ? Boolean(value.originalRemittanceId) : !value.originalRemittanceId, "An actual return names its exact original remittance."),
  output: z.object({ recorded: z.literal(true) }),
  handler: async (input, ctx) => {
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`agreement-fee-remittance:${input.idempotencyKey}`}))`);
    await lockAgreementFeeSources(ctx, input.invoiceId);
    const hash = merchantTaxDigest(input), [prior] = await ctx.tx.select().from(agreementFeeRemittances).where(eq(agreementFeeRemittances.idempotencyKey, input.idempotencyKey)).limit(1);
    if (prior) {
      if (prior.invoiceId !== input.invoiceId || prior.requestDigest !== hash) throw new ServiceError("conflict", "Preserve the first exact original commission remittance receipt.");
      return { recorded: true as const };
    }
    const current = await originalAgreementFeeState(ctx, input.invoiceId);
    if (!current) throw new ServiceError("not_found", "The original accepted commission duty is unavailable.");
    if (current.reviewRequired || !current.eligible || current.owedMinor === null || current.recordedMinor === null)
      throw new ServiceError("conflict", "Restore actual full-settlement eligibility and complete current cash/noncash disposition before recording commission money.");
    const original = current.witness.receipts.find(row => row.id === input.originalRemittanceId && row.direction === "remitted");
    if (input.direction === "remitted" && BigInt(current.recordedMinor) + BigInt(input.amountMinor) > BigInt(current.owedMinor)
      || input.direction === "returned" && (!original || current.witness.receipts.filter(row => row.originalRemittanceId === original.id).reduce((sum, row) => sum + BigInt(row.amountMinor), 0n) + BigInt(input.amountMinor) > BigInt(original.amountMinor)))
      throw new ServiceError("conflict", "Record only an actually remaining original commission receivable or an actual return bounded by its exact remittance receipt.");
    await agreementFeeWriter(ctx);
    await ctx.tx.insert(agreementFeeRemittances).values({ id: randomUUID(), invoiceId: input.invoiceId, direction: input.direction, originalRemittanceId: input.originalRemittanceId ?? null,
      amountMinor: input.amountMinor, currency: current.currency, recordedBy: actorString(ctx.actor), idempotencyKey: input.idempotencyKey, requestDigest: hash,
      evidenceDigest: merchantTaxDigest({ reference: input.reference, evidence: input.evidence, originalDuty: current.witness.duty.originalOwnerDigest, currentDisposition: current.witness.revision }) });
    ctx.setSubject("invoice", input.invoiceId); return { recorded: true as const };
  },
});

export default [reviewAgreementFee, recordAgreementFeeRemittance];
