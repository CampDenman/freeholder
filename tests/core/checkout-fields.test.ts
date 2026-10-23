// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Which checkout fields a refusal is about (C5.21, 2026-10-23 demo audit):
// the storefront used to say "Some details need attention" and mark nothing.

import { describe, expect, it } from "vitest";
import { ServiceError } from "@/core/service";
import { PLAYGROUND_FICTIONAL_EMAIL } from "@/core/demo/playground-policy";
import { CheckoutFieldError, checkoutRefusal, fieldsFromQuery } from "@/modules/catalog/checkout-fields";

describe("checkoutRefusal", () => {
  it("passes a field-aware refusal through, still a validation ServiceError", () => {
    const error = new CheckoutFieldError("No shipping method reaches that destination.", ["country", "postalCode"], "delivery");
    expect(error).toBeInstanceOf(ServiceError);
    expect(error.code).toBe("validation");
    expect(checkoutRefusal(error)).toEqual({ reason: "delivery", fields: ["country", "postalCode"] });
  });

  it("maps input validation paths onto the form's own fields", () => {
    const error = new ServiceError(
      "validation",
      "catalog.shopperCheckout: email: Invalid email address; shippingAddress.country: Invalid string; shippingAddress.postalCode: Too long",
    );
    expect(checkoutRefusal(error)).toEqual({ reason: "validation", fields: ["email", "country", "postalCode"] });
  });

  it("names the email for the playground rule and the code for a coupon", () => {
    expect(checkoutRefusal(new ServiceError("validation", PLAYGROUND_FICTIONAL_EMAIL))).toEqual({
      reason: "playgroundEmail",
      fields: ["email"],
    });
    expect(checkoutRefusal(new ServiceError("not_found", "That coupon code cannot be used."))).toEqual({
      reason: "coupon",
      fields: ["couponCode"],
    });
  });

  it("leaves faults that are not about the shopper's answers alone", () => {
    expect(checkoutRefusal(new Error("boom"))).toBeNull();
    expect(checkoutRefusal(new ServiceError("conflict", "That cart was already converted."))).toBeNull();
    expect(checkoutRefusal(new ServiceError("not_found", "That cart is not here."))).toBeNull();
  });

  it("keeps only real field names from a URL", () => {
    expect(fieldsFromQuery("country,postalCode,<script>,email")).toEqual(["country", "postalCode", "email"]);
    expect(fieldsFromQuery(undefined)).toEqual([]);
    expect(fieldsFromQuery(["country"])).toEqual([]);
  });
});
