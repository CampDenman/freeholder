// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: auxiliary product creation has its own physical intent and ACK.
import { AdapterError } from "../types";
import { object, text } from "./http";
import { validateMerchantChargeScope } from "./stripe-merchant-scope";
import { STRIPE_MERCHANT_SCHEDULE_API_VERSION } from "./stripe-subscription-quiescence";
import type { StripeSubscriptionRead } from "./stripe-subscription-origin";
import type { MerchantPhaseProductReadRequest, MerchantPhaseProductRequest } from "./types";
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function unproven(): never { throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not prove this original agreement's auxiliary product.", true); }
type Body = Omit<MerchantPhaseProductRequest, "onProductAcknowledged">;
function validate(request: Body | MerchantPhaseProductReadRequest) {
  validateMerchantChargeScope(request);
  if (!request.providerPlatformAccountId || request.providerScheduleApiVersion !== STRIPE_MERCHANT_SCHEDULE_API_VERSION
    || request.providerApiVersion !== undefined && request.providerApiVersion !== request.providerScheduleApiVersion
    || !uuid(request.subscriptionId) || !uuid(request.operationId) || !request.name.trim() || request.name.length > 500
    || !request.destinationAccountId && !request.providerAccountId) unproven();
}
function metadata(request: Body | MerchantPhaseProductReadRequest) {
  return { freeholder_subscription_id: request.subscriptionId, freeholder_phase_product_operation_id: request.operationId,
    freeholder_platform_account_id: request.providerPlatformAccountId, freeholder_schedule_api_version: request.providerScheduleApiVersion };
}
export function stripeMerchantPhaseProductBody(request: Body): URLSearchParams {
  validate(request);
  const body = new URLSearchParams({ name: Array.from(request.name).slice(0, 250).join(""), active: "true" });
  for (const [key, value] of Object.entries(metadata(request))) body.set(`metadata[${key}]`, value);
  return body;
}
export async function inspectOriginalStripePhaseProduct(api: StripeSubscriptionRead, request: MerchantPhaseProductReadRequest) {
  validate(request);
  if (!/^prod_[A-Za-z0-9]{1,195}$/.test(request.providerProductRef)) unproven();
  const actual = await api(`/v1/products/${encodeURIComponent(request.providerProductRef)}`, { method: "GET", headers: { "stripe-version": request.providerScheduleApiVersion } }, { ...request, providerApiVersion: request.providerScheduleApiVersion });
  if (actual.id !== request.providerProductRef || actual.object !== "product" || actual.active !== true || actual.name !== Array.from(request.name).slice(0, 250).join("")
    || !Object.entries(metadata(request)).every(([key, value]) => object(actual.metadata)?.[key] === value)) unproven();
  return { providerProductRef: request.providerProductRef };
}
export async function createOriginalStripePhaseProduct(api: StripeSubscriptionRead, request: MerchantPhaseProductRequest) {
  validate(request);
  if (!request.idempotencyKey || request.idempotencyKey.length > 200) unproven();
  const actual = await api("/v1/products", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "stripe-version": request.providerScheduleApiVersion,
    "idempotency-key": request.idempotencyKey }, body: stripeMerchantPhaseProductBody(request) }, { ...request, providerApiVersion: request.providerScheduleApiVersion });
  const providerProductRef = text(actual.id);
  if (!providerProductRef || !/^prod_[A-Za-z0-9]{1,195}$/.test(providerProductRef)) unproven();
  await request.onProductAcknowledged({ providerProductRef });
  return inspectOriginalStripePhaseProduct(api, { ...request, providerProductRef });
}
