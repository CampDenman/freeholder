// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: intercepted authenticated GETs, never provider acceptance.
import { describe, expect, it } from "vitest";
import { inspectStripeSubscriptionPeriod } from "@/adapters/payments/stripe-subscription-period";
import type { MerchantScheduleWebhookScope } from "@/adapters/payments";
import type { StripeSubscriptionRead } from "@/adapters/payments/stripe-subscription-origin";
const scope: MerchantScheduleWebhookScope = { subscriptionId: "00000000-0000-4000-8000-000000000001", providerScheduleOperationId: "00000000-0000-4000-8000-000000000002",
  providerSubscriptionRef: "sub_original", providerCustomerRef: "cus_original", providerPlatformAccountId: "acct_platform", providerAccountId: "acct_seller", providerScheduleApiVersion: "2026-10-28.endive" };
const invoice = { id: "in_original", customer: "cus_original", currency: "cad", subtotal: 4725, total: 4725, amount_paid: 4725, amount_remaining: 0, status: "paid", paid_out_of_band: false,
  collection_method: "charge_automatically", automatic_tax: { enabled: false }, total_taxes: [], total_discount_amounts: [], discounts: [], starting_balance: 0, ending_balance: 0,
  amount_shipping: 0, pre_payment_credit_notes_amount: 0, post_payment_credit_notes_amount: 0 };
const metadata = { freeholder_subscription_operation_id: scope.providerScheduleOperationId, freeholder_subscription_terms_id: "00000000-0000-4000-8000-000000000003", freeholder_phase_digest: "a".repeat(64) };
const line = (id = "il_original") => ({ id, invoice: "in_original", amount: 4725, currency: "cad", quantity: 1, quantity_decimal: "1.000000000000", period: { start: 1796083200, end: 1798761600 },
  pricing: { type: "price_details", price_details: { price: "price_original" } }, parent: { type: "subscription_item_details", subscription_item_details: { proration: false } },
  discount_amounts: [], discounts: [], taxes: [], pretax_credit_amounts: [], metadata: { freeholder_phase_digest: "mutated-line-metadata" } });
const price = { id: "price_original", object: "price", product: "prod_original", unit_amount: 4725, currency: "cad", recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
  billing_scheme: "per_unit", tax_behavior: "inclusive", transform_quantity: null };
describe("actual original provider period read", () => {
  it("reads every actual line and independent price with the original account/API version, ignoring dynamic line metadata", async () => {
    const paths: string[] = [];
    const api: StripeSubscriptionRead = async (path, init, original) => {
      paths.push(path); expect(init.method).toBe("GET"); expect(original.providerPlatformAccountId).toBe("acct_platform"); expect(original.providerAccountId).toBe("acct_seller");
      expect(new Headers(init.headers).get("stripe-version")).toBe("2026-10-28.endive");
      if (path === "/v1/prices/price_original") return price;
      return { data: [line()], has_more: false };
    };
    const result = await inspectStripeSubscriptionPeriod(api, scope, invoice, metadata);
    expect(paths).toEqual(["/v1/invoices/in_original/lines?limit=100", "/v1/prices/price_original"]);
    expect(result.phaseDigest).toBe(metadata.freeholder_phase_digest); expect(result.lines[0]?.quantityDecimal).toBe("1.000000000000"); expect(result.lines[0]?.priceAmountMinor).toBe(4725);
  });
  it("follows actual page cursors instead of trusting the embedded invoice summary", async () => {
    const paths: string[] = [];
    const api: StripeSubscriptionRead = async path => { paths.push(path); if (path === "/v1/prices/price_original") return price;
      return path.includes("starting_after=") ? { data: [line("il_second")], has_more: false } : { data: [line()], has_more: true }; };
    const result = await inspectStripeSubscriptionPeriod(api, scope, invoice, metadata);
    expect(result.lines).toHaveLength(2); expect(paths).toContain("/v1/invoices/in_original/lines?limit=100&starting_after=il_original");
  });
  it("refuses repeated page items rather than presenting an incomplete invoice as complete", async () => {
    const api: StripeSubscriptionRead = async path => path === "/v1/prices/price_original" ? price : { data: [line()], has_more: true };
    await expect(inspectStripeSubscriptionPeriod(api, scope, invoice, metadata)).rejects.toThrow();
  });
  it("refuses a line from another actual invoice", async () => {
    const api: StripeSubscriptionRead = async () => ({ data: [{ ...line(), invoice: "in_foreign" }], has_more: false });
    await expect(inspectStripeSubscriptionPeriod(api, scope, invoice, metadata)).rejects.toThrow();
  });
  it("retains missing or contradictory price details as unproven normalized facts", async () => {
    const api: StripeSubscriptionRead = async path => path === "/v1/prices/price_original" ? { ...price, tax_behavior: "exclusive", transform_quantity: { divide_by: 100, round: "up" } } : { data: [line()], has_more: false };
    const result = await inspectStripeSubscriptionPeriod(api, scope, invoice, metadata); expect(result.lines[0]?.inclusive).toBe(false); expect(result.lines[0]?.noTransform).toBe(false);
  });
  it("does not declare out-of-band credit settlement to be paid original provider cash", async () => {
    const api: StripeSubscriptionRead = async path => path === "/v1/prices/price_original" ? price : { data: [line()], has_more: false };
    expect((await inspectStripeSubscriptionPeriod(api, scope, { ...invoice, paid_out_of_band: true }, metadata)).paid).toBe(false);
  });
});
