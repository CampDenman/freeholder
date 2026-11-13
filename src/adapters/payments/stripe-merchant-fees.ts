// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.26/C12.38: refund exact ledger commission, without proportional guessing.
import { AdapterError } from "../types";
import { number, object, text } from "./http";
import { validateMerchantChargeScope } from "./stripe-merchant-scope";
import type { MerchantChargeScope, MerchantFeeRefundRequest, MerchantFeeRefundResult, MerchantFeeObservation } from "./types";

type Api = (path: string, init: RequestInit, scope: MerchantChargeScope) => Promise<Record<string, unknown>>;
const unresolved = () => new AdapterError("payments", "stripe", "provider_failure", "Stripe did not prove the original application-fee refund.", true);

function originalFee(request: MerchantFeeRefundRequest, fee: Record<string, unknown>): void {
  const account = typeof fee.account === "string" ? fee.account : text(object(fee.account)?.id);
  const originalCharge = request.destinationAccountId ? fee.originating_transaction : fee.charge;
  const charge = typeof originalCharge === "string" ? originalCharge : text(object(originalCharge)?.id);
  if (fee.id !== request.applicationFeeRef || account !== (request.destinationAccountId ?? request.providerAccountId)
    || charge !== request.providerChargeRef || text(fee.currency)?.toUpperCase() !== request.currency
    || (number(fee.amount) ?? -1) < request.amountMinor) throw unresolved();
}

function physicalRefund(request: MerchantFeeRefundRequest, value: Record<string, unknown>): MerchantFeeObservation | null {
  const providerRef = text(value.id), applicationFeeRef = text(value.fee), amountMinor = number(value.amount), currency = text(value.currency)?.toUpperCase();
  if (!providerRef || !/^fr_[A-Za-z0-9]+$/.test(providerRef) || !applicationFeeRef || !/^fee_[A-Za-z0-9]+$/.test(applicationFeeRef)
    || amountMinor === undefined || amountMinor < 0 || !currency || !/^[A-Z]{3}$/.test(currency)) return null;
  return { providerRef, applicationFeeRef, amountMinor, currency, bindingVerified: applicationFeeRef === request.applicationFeeRef
    && amountMinor === request.amountMinor && currency === request.currency && text(object(value.metadata)?.freeholder_fee_refund_id) === request.operationId };
}

function refundEvidence(request: MerchantFeeRefundRequest, value: Record<string, unknown>): MerchantFeeRefundResult {
  const providerRef = text(value.id);
  if (!providerRef || !/^fr_[A-Za-z0-9]+$/.test(providerRef) || value.fee !== request.applicationFeeRef
    || value.amount !== request.amountMinor || text(value.currency)?.toUpperCase() !== request.currency
    || text(object(value.metadata)?.freeholder_fee_refund_id) !== request.operationId) throw unresolved();
  return { providerRef, applicationFeeRef: request.applicationFeeRef, amountMinor: request.amountMinor, currency: request.currency };
}

export function stripeMerchantFees(api: Api) {
  async function prepare(request: MerchantFeeRefundRequest) {
    validateMerchantChargeScope(request);
    if (!request.providerPlatformAccountId || !(request.providerAccountId || request.destinationAccountId)
      || !/^fee_[A-Za-z0-9]+$/.test(request.applicationFeeRef) || request.applicationFeeRef.length > 200
      || !/^ch_[A-Za-z0-9]+$/.test(request.providerChargeRef) || request.providerChargeRef.length > 200
      || !Number.isSafeInteger(request.amountMinor) || request.amountMinor <= 0 || !/^[A-Z]{3}$/.test(request.currency)
      || !/^[0-9a-f-]{36}$/.test(request.operationId) || !request.idempotencyKey || request.idempotencyKey.length > 240) {
      throw new AdapterError("payments", "stripe", "invalid_request", "The original application-fee refund facts are incomplete.");
    }
    // Application fees belong to the original platform even for direct charges.
    // Retain the seller account above for evidence, but never send its header.
    const scope = { providerPlatformAccountId: request.providerPlatformAccountId, ...(request.providerApiVersion ? { providerApiVersion: request.providerApiVersion } : {}) };
    const path = `/v1/application_fees/${encodeURIComponent(request.applicationFeeRef)}`;
    originalFee(request, await api(path, { method: "GET" }, scope));
    return { scope, path };
  }

  return {
    async refundMerchantFee(request: MerchantFeeRefundRequest): Promise<MerchantFeeRefundResult> {
      const { scope, path } = await prepare(request);
      const form = new URLSearchParams({ amount: String(request.amountMinor), "metadata[freeholder_fee_refund_id]": request.operationId });
      const result = await api(`${path}/refunds`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "idempotency-key": request.idempotencyKey }, body: form }, scope);
      const observed = physicalRefund(request, result);
      if (observed) await request.onFeeRefundObserved?.(observed);
      return refundEvidence(request, result);
    },
    async recoverMerchantFeeRefund(request: MerchantFeeRefundRequest): Promise<MerchantFeeRefundResult | null> {
      const { scope, path } = await prepare(request);
      let cursor: string | undefined;
      let found: MerchantFeeRefundResult | null = null;
      for (let page = 0; page < 10; page++) {
        const query = new URLSearchParams({ limit: "100", ...(cursor ? { starting_after: cursor } : {}) });
        const result = await api(`${path}/refunds?${query}`, { method: "GET" }, scope);
        if (!Array.isArray(result.data) || typeof result.has_more !== "boolean") throw unresolved();
        for (const raw of result.data) {
          const row = object(raw);
          if (!row || !text(row.id)) throw unresolved();
          if (text(object(row.metadata)?.freeholder_fee_refund_id) !== request.operationId) continue;
          if (found) throw unresolved();
          const observed = physicalRefund(request, row);
          if (observed) await request.onFeeRefundObserved?.(observed);
          found = refundEvidence(request, row);
        }
        if (!result.has_more) return found;
        const next = text(object(result.data.at(-1))?.id);
        if (!next || next === cursor) throw unresolved();
        cursor = next;
      }
      throw unresolved();
    },
  };
}
