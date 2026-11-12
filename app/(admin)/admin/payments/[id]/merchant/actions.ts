// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import { actorString, ServiceError } from "@/core/service";
import { reconcileMerchantCheckout } from "@/modules/invoicing/merchant-payment-recovery";
import { inspectMerchantPayment } from "@/modules/invoicing/payment-provider-service";
import { requireStaffActor } from "../../../guard";
import { sealCheckoutLink } from "./checkout-link";

export async function reconcileMerchantPaymentAction(form: FormData): Promise<void> {
  const field = (name: string) => { const value = form.get(name); return typeof value === "string" ? value.trim() : ""; };
  const paymentId = field("paymentId");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paymentId)) redirect("/admin/payments?error=validation");
  const path = `/admin/payments/${paymentId}/merchant`;
  const actor = { ...await requireStaffActor("invoicing", "manage"), request: requestMetadataFromHeaders(await headers()) };
  let state: string;
  try {
    if (field("action") === "inspect_charge") {
      const result = await inspectMerchantPayment.call({ paymentId }, actor);
      state = result.unapplied ? "unresolved" : result.evidence.status === "succeeded" ? "paid" : "pending";
    } else {
      const action = field("action");
      if (action !== "inspect" && action !== "retire") throw new ServiceError("validation", "Choose an original payment reconciliation action.");
      const result = await reconcileMerchantCheckout.call({ paymentId, action, ...(field("checkoutRef") ? { checkoutRef: field("checkoutRef") } : {}), ...(field("paymentRef") ? { paymentRef: field("paymentRef") } : {}) }, actor);
      state = result.unapplied ? "unresolved" : result.state;
      if (result.state === "open" && result.checkoutUrl && result.checkoutExpiresAt) {
        const kept = sealCheckoutLink({ paymentId, owner: actorString(actor), url: result.checkoutUrl, expiresAt: result.checkoutExpiresAt });
        if (kept) (await cookies()).set("freeholder_merchant_checkout_review", kept, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path, maxAge: 300 });
      }
    }
  } catch (error) {
    const code = error instanceof ServiceError && ["validation", "permission", "conflict", "not_found", "rate_limited"].includes(error.code) ? error.code : "failed";
    redirect(`${path}?error=${code}`);
  }
  redirect(`${path}?saved=${state}`);
}
