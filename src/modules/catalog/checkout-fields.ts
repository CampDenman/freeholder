// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Which checkout field a refusal is about (C5.21).
//
// The storefront checkout is a Server Action that redirects, so a refusal
// re-renders the page from scratch. Before this, every refusal said "Some
// details need attention" with no field marked and the address wiped
// (2026-10-23 demo audit). The services keep their plain-language messages;
// this names the form fields a refusal concerns so the page can mark them,
// and the reason the shopper should read.
//
// Pure on purpose: the checkout services throw CheckoutFieldError, the action
// reads checkoutRefusal, and both are testable without a request.
import { ServiceError } from "@/core/service";
import { PLAYGROUND_FICTIONAL_EMAIL } from "@/core/demo/playground-policy";

export const CHECKOUT_FIELDS = [
  "email",
  "name",
  "street1",
  "city",
  "region",
  "postalCode",
  "country",
  "shippingMethodId",
  "couponCode",
] as const;

export type CheckoutField = (typeof CHECKOUT_FIELDS)[number];

/** The checkout's key in the public form-return cookie. */
export const CHECKOUT_RETURN_KEY = "checkout";

/** Refusal reasons the checkout page has its own words for. */
export type CheckoutReason =
  | "validation"
  | "address"
  | "delivery"
  | "chooseMethod"
  | "coverage"
  | "coupon"
  | "playgroundEmail";

/**
 * A validation refusal that knows which fields it is about. Still a
 * ServiceError, so every caller that only reads `code` behaves as before.
 */
export class CheckoutFieldError extends ServiceError {
  constructor(
    message: string,
    readonly fields: readonly CheckoutField[],
    readonly reason: CheckoutReason,
  ) {
    super("validation", message);
  }
}

// Zod issue paths as the service layer prints them ("shippingAddress.country:
// Invalid string"), mapped onto the form's own field names.
const PATH_FIELDS: Record<string, CheckoutField> = {
  email: "email",
  name: "name",
  "shippingAddress.name": "name",
  "shippingAddress.street1": "street1",
  "shippingAddress.city": "city",
  "shippingAddress.region": "region",
  "shippingAddress.postalCode": "postalCode",
  "shippingAddress.country": "country",
  shippingMethodId: "shippingMethodId",
  couponCode: "couponCode",
};

/**
 * The reason and fields for a refused checkout, or null when the refusal is
 * not about anything the shopper typed (an expired cart, a server fault).
 */
export function checkoutRefusal(error: unknown): { reason: CheckoutReason; fields: CheckoutField[] } | null {
  if (error instanceof CheckoutFieldError) return { reason: error.reason, fields: [...error.fields] };
  if (!(error instanceof ServiceError)) return null;
  if (error.message === PLAYGROUND_FICTIONAL_EMAIL) return { reason: "playgroundEmail", fields: ["email"] };
  if (error.code !== "validation" && error.code !== "not_found") return null;
  if (/coupon/i.test(error.message)) return { reason: "coupon", fields: ["couponCode"] };
  if (error.code !== "validation") return null;
  const fields = new Set<CheckoutField>();
  // "catalog.shopperCheckout: email: Invalid email; couponCode: …"
  const details = error.message.replace(/^[a-z]+\.[A-Za-z]+: /, "");
  for (const issue of details.split("; ")) {
    const path = issue.slice(0, issue.indexOf(":"));
    const field = PATH_FIELDS[path];
    if (field) fields.add(field);
  }
  return { reason: "validation", fields: [...fields] };
}

/** The fields a URL names, keeping only real ones. */
export function fieldsFromQuery(value: unknown): CheckoutField[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .filter((name): name is CheckoutField => (CHECKOUT_FIELDS as readonly string[]).includes(name));
}
