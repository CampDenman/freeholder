// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: fresh read authority never invents original create metadata.
import { z } from "zod";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const account = z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200);
export const legacyBankOriginal = z.object({
  refundId: z.uuid(), paymentId: z.uuid(), invoiceId: z.uuid(), provider: z.literal("stripe"),
  originalRefundRef: z.string().regex(/^(?:re|pyr)_[A-Za-z0-9_]+$/).max(200),
  originalPaymentRef: z.string().regex(/^pi_[A-Za-z0-9_]+$/).max(200),
  originalChargeAccountId: account.nullable(), originalCreatePlatformAccountId: z.null(), originalCreateProtocolVersion: z.null(),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  originalCashAmountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), currency: z.string().regex(/^[A-Z]{3}$/),
  originalHistoryDigest: digest,
}).strict();
export type LegacyBankOriginal = z.infer<typeof legacyBankOriginal>;
export const legacyBankFactKind = z.enum(["exact_refund", "primary_cash", "inventory_refund", "cash_inventory"]);
export const legacyBankReadFact = z.object({
  kind: legacyBankFactKind,
  value: z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
    try { if (Buffer.byteLength(JSON.stringify(value)) > 4 * 1024 * 1024) ctx.addIssue({ code: "custom", message: "The original bounded provider fact exceeds its retained evidence budget." }); }
    catch { ctx.addIssue({ code: "custom", message: "Retain only serializable original provider facts." }); }
  }),
}).strict();
export const legacyBankReadNonce = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const legacyBankReadFinishInput = z.object({ readId: z.uuid(), completionNonce: legacyBankReadNonce }).strict();
