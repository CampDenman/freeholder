// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: nullable raw facts remain distinct from absent provider effects.
import { z } from "zod";
const ref = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9_]+$`)).max(200);
const minor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), currency = z.string().regex(/^[A-Z]{3}$/);
export const merchantReturnedCashEvidenceSchema = z.object({
  providerPlatformAccountId: ref("acct"), chargeAccountId: ref("acct").nullable(), providerApiVersion: z.enum(["2026-02-25.clover", "2026-10-28.endive"]),
  paymentProviderRef: ref("pi"), providerChargeRef: ref("ch"), amountMinor: minor, currency, paymentIntentStatus: z.string().min(1).max(100), amountCapturableMinor: minor.nullable(),
  chargePaymentProviderRef: ref("pi").nullable(), chargeAmountMinor: minor.nullable(), chargeCurrency: currency.nullable(),
  paid: z.boolean().nullable(), captured: z.boolean().nullable(), refunded: z.boolean().nullable(), amountRefundedMinor: minor.nullable(), refundsComplete: z.boolean(),
  refunds: z.array(z.object({ providerRef: ref("re"), paymentProviderRef: ref("pi").nullable(), chargeRef: ref("ch").nullable(), amountMinor: minor.nullable(), currency: currency.nullable(),
    status: z.enum(["pending", "requires_action", "succeeded", "failed", "canceled"]).nullable() }).strict()).max(1000),
  feeFieldObserved: z.boolean(), fee: z.object({ providerRef: ref("fee"), originatingChargeRef: ref("ch").nullable(), accountId: ref("acct").nullable(),
    amountMinor: minor.nullable(), refundedMinor: minor.nullable(), currency: currency.nullable() }).strict().nullable(),
  transferFieldObserved: z.boolean(), transfer: z.object({ providerRef: ref("tr"), sourceChargeRef: ref("ch").nullable(), destinationAccountId: ref("acct").nullable(),
    amountMinor: minor.nullable(), reversedMinor: minor.nullable(), currency: currency.nullable(), reversed: z.boolean().nullable() }).strict().nullable(),
  disputesComplete: z.boolean(), disputes: z.array(z.object({ providerRef: ref("du"), chargeRef: ref("ch").nullable(), status: z.string().min(1).max(100) }).strict()).max(1000),
}).strict();
