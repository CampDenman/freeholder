// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: independent exact fee/refund and transfer/reversal POST, then GET only.
import { AdapterError } from "../types";
import { number, object, text } from "./http";
import type { MerchantChargeScope } from "./types";
import type { MerchantCashAuxiliaryEvidence, MerchantCashAuxiliaryRequest } from "./merchant-cash-auxiliary-types";
type Api = (path: string, init: RequestInit, scope: MerchantChargeScope) => Promise<Record<string, unknown>>;
const unresolved = () => new AdapterError("payments", "stripe", "provider_failure", "Restore the exact original fee or recipient return; no further creation is authorized.", true);
const ref = (value: unknown) => typeof value === "string" ? value : text(object(value)?.id) ?? null;
const minor = (value: unknown) => { const amount = number(value); return amount !== undefined && Number.isSafeInteger(amount) && amount >= 0 ? amount : null; };
export function merchantCashAuxiliaryBody(operationId: string, amountMinor: number) {
  return new URLSearchParams({ amount: String(amountMinor), "metadata[freeholder_cash_auxiliary_id]": operationId }).toString();
}
export function stripeCashAuxiliary(api: Api) {
  async function parent(request: MerchantCashAuxiliaryRequest, creating: boolean) {
    const parentPattern = request.kind === "fee" ? /^fee_[A-Za-z0-9_]+$/ : /^tr_[A-Za-z0-9_]+$/;
    if (!parentPattern.test(request.parentRef) || !/^acct_[A-Za-z0-9]+$/.test(request.providerPlatformAccountId)
      || !/^acct_[A-Za-z0-9]+$/.test(request.originalAccountId) || !/^ch_[A-Za-z0-9_]+$/.test(request.originalChargeRef)
      || !/^[0-9a-f-]{36}$/.test(request.operationId) || !/^[A-Z]{3}$/.test(request.currency)
      || !["2026-02-25.clover", "2026-10-28.endive"].includes(request.providerApiVersion)
      || ![request.amountMinor, request.originalAmountMinor, request.alreadyReturnedMinor].every(value => Number.isSafeInteger(value) && value >= 0)
      || request.amountMinor <= 0 || request.frozenBody !== merchantCashAuxiliaryBody(request.operationId, request.amountMinor)) throw unresolved();
    // Both object families belong to the actual original platform. No seller
    // header, implicit current API version, automatic fee refund or FX guess.
    const scope = { providerPlatformAccountId: request.providerPlatformAccountId, providerApiVersion: request.providerApiVersion };
    const path = `/v1/${request.kind === "fee" ? "application_fees" : "transfers"}/${encodeURIComponent(request.parentRef)}`;
    const actual = await api(path, { method: "GET" }, scope);
    const charge = request.kind === "fee" ? ref(actual.originating_transaction) ?? ref(actual.charge) : ref(actual.source_transaction);
    const account = request.kind === "fee" ? ref(actual.account) : ref(actual.destination);
    const returned = minor(request.kind === "fee" ? actual.amount_refunded : actual.amount_reversed);
    await request.onParentObserved({ providerRef: ref(actual.id), chargeRef: charge, accountId: account, amountMinor: minor(actual.amount), returnedMinor: returned, currency: text(actual.currency)?.toUpperCase() ?? null });
    if (actual.id !== request.parentRef || charge !== request.originalChargeRef || account !== request.originalAccountId
      || minor(actual.amount) !== request.originalAmountMinor || text(actual.currency)?.toUpperCase() !== request.currency || returned === null
      || creating && (returned !== request.alreadyReturnedMinor || BigInt(returned) + BigInt(request.amountMinor) > BigInt(request.originalAmountMinor))) throw unresolved();
    return { scope, path: `${path}/${request.kind === "fee" ? "refunds" : "reversals"}` };
  }
  async function observe(request: MerchantCashAuxiliaryRequest, actual: Record<string, unknown>) {
    const providerRef = ref(actual.id), pattern = request.kind === "fee" ? /^fr_[A-Za-z0-9_]+$/ : /^trr_[A-Za-z0-9_]+$/;
    if (!providerRef || !pattern.test(providerRef)) throw unresolved();
    // The ID survives wrong money, missing fields and later parsing failures.
    await request.onResourceAcknowledged(providerRef);
    const evidence: MerchantCashAuxiliaryEvidence = { providerRef, parentRef: ref(request.kind === "fee" ? actual.fee : actual.transfer),
      amountMinor: minor(actual.amount), currency: text(actual.currency)?.toUpperCase() ?? null,
      operationId: text(object(actual.metadata)?.freeholder_cash_auxiliary_id) ?? null, bindingVerified: false };
    evidence.bindingVerified = evidence.parentRef === request.parentRef && evidence.operationId === request.operationId
      && evidence.amountMinor === request.amountMinor && evidence.currency === request.currency
      && (!request.originalResourceRef || evidence.providerRef === request.originalResourceRef);
    await request.onResourceObserved(evidence);
    if (!evidence.bindingVerified) throw unresolved();
    return evidence;
  }
  return {
    async createMerchantCashAuxiliary(request: MerchantCashAuxiliaryRequest) {
      const original = await parent(request, true);
      return observe(request, await api(original.path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "idempotency-key": request.idempotencyKey }, body: request.frozenBody }, original.scope));
    },
    async recoverMerchantCashAuxiliary(request: MerchantCashAuxiliaryRequest): Promise<MerchantCashAuxiliaryEvidence | null> {
      const original = await parent(request, false);
      if (request.originalResourceRef) return observe(request, await api(`${original.path}/${encodeURIComponent(request.originalResourceRef)}`, { method: "GET" }, original.scope));
      let cursor: string | undefined, found: MerchantCashAuxiliaryEvidence | null = null;
      for (let page = 0; page < 10; page++) {
        const query = new URLSearchParams({ limit: "100", ...(cursor ? { starting_after: cursor } : {}) });
        const response = await api(`${original.path}?${query}`, { method: "GET" }, original.scope);
        if (!Array.isArray(response.data) || typeof response.has_more !== "boolean") throw unresolved();
        for (const value of response.data) {
          const row = object(value); if (!row || !ref(row.id)) throw unresolved();
          if (text(object(row.metadata)?.freeholder_cash_auxiliary_id) !== request.operationId) continue;
          // Retain every matching actual resource before detecting ambiguity.
          const actual = await observe(request, row); if (found) throw unresolved(); found = actual;
        }
        if (!response.has_more) return found;
        const next = ref(object(response.data.at(-1))?.id); if (!next || next === cursor) throw unresolved(); cursor = next;
      }
      throw unresolved();
    },
  };
}
