// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: current authenticated read facts are not historical create facts.
import { AdapterError } from "../types";
import { number, object, text } from "./http";
import { STRIPE_REFUND_REFERENCE } from "./stripe-refund-reference";
import type { LegacyBankRefundReadEvidence, LegacyBankRefundReadRequest, PaymentAccountScope } from "./types";

type Api = (path: string, init: RequestInit, scope?: PaymentAccountScope) => Promise<Record<string, unknown>>;
const readProtocolVersion = "2026-02-25.clover" as const;
const reference = (value: unknown) => text(value) ?? text(object(value)?.id) ?? null;
const short = (value: unknown, max = 200) => typeof value === "string" && value.length <= max ? value : null;
const error = () => new AdapterError("payments", "stripe", "provider_failure", "Restore the exact historical refund, cash and account before bank reconciliation.", true);

export function stripeLegacyBankRead(api: Api) {
  return {
    async inspectLegacyBankRefund(request: LegacyBankRefundReadRequest): Promise<LegacyBankRefundReadEvidence> {
      if (!STRIPE_REFUND_REFERENCE.test(request.originalRefundRef) || request.originalRefundRef.length > 200
        || !/^pi_[A-Za-z0-9_]+$/.test(request.originalPaymentRef) || request.originalPaymentRef.length > 200
        || !Number.isSafeInteger(request.amountMinor) || request.amountMinor <= 0 || !/^[A-Z]{3}$/.test(request.currency)
        || request.originalChargeAccountId !== null && !/^acct_[A-Za-z0-9]+$/.test(request.originalChargeAccountId)
        || typeof request.onRefundObserved !== "function") throw error();
      const account = await api("/v1/account", { method: "GET" }, { providerApiVersion: readProtocolVersion });
      const actualPlatform = text(account.id);
      if (!actualPlatform || !/^acct_[A-Za-z0-9]+$/.test(actualPlatform) || actualPlatform.length > 200) throw error();
      // This observed platform authenticates THIS read. It does not fill a
      // missing original platform field in historical money or route rows.
      const value = await api(`/v1/refunds/${encodeURIComponent(request.originalRefundRef)}`, { method: "GET" }, {
        providerApiVersion: readProtocolVersion, providerPlatformAccountId: actualPlatform,
        ...(request.originalChargeAccountId ? { providerAccountId: request.originalChargeAccountId } : {}),
      });
      const rawAmount = number(value.amount), rawCurrency = short(value.currency, 3)?.toUpperCase() ?? null;
      const observed: LegacyBankRefundReadEvidence = {
        requestedRefundRef: request.originalRefundRef, observedRefundRef: short(reference(value.id)),
        observedPaymentRef: short(reference(value.payment_intent)), observedChargeRef: short(reference(value.charge)),
        amountMinor: rawAmount !== undefined && Number.isSafeInteger(rawAmount) && rawAmount > 0 ? rawAmount : null,
        currency: rawCurrency && /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : null,
        rawProviderStatus: short(value.status, 100), failureReason: short(value.failure_reason, 100),
        failureBalanceTransactionRef: short(reference(value.failure_balance_transaction)),
        readProtocolVersion, readProviderPlatformAccountId: actualPlatform, chargeAccountId: request.originalChargeAccountId,
        originalCreateProtocolVersion: null, originalCreatePlatformAccountId: null, originalBindingVerified: false,
      };
      observed.originalBindingVerified = observed.observedRefundRef === request.originalRefundRef
        && observed.observedPaymentRef === request.originalPaymentRef && observed.amountMinor === request.amountMinor && observed.currency === request.currency;
      // Retain a contradictory or nullable response before refusing policy.
      // There is no guessed refund-attempt UUID or POST capability here.
      await request.onRefundObserved(observed);
      return observed;
    },
  };
}
