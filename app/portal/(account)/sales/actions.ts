// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.10: what buyers and sellers do on a sale.
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { leaveReview, replyToReview } from "@/modules/members/reputation";
import { confirmDelivery, DISPUTE_REASONS, markShipped, postSaleMessage, raiseDispute, withdrawDispute } from "@/modules/members/protection";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function saleAction(form: FormData): Promise<void> {
  const orderId = text(form, "orderId");
  const sellerId = text(form, "sellerId");
  const base = text(form, "side") === "seller" ? "/portal/sales" : "/portal/purchases";
  const path = /^[0-9a-f-]{36}$/.test(orderId) && /^[0-9a-f-]{36}$/.test(sellerId) ? `${base}/${orderId}/${sellerId}` : base;
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  const sale = { orderId, sellerId };
  const reason = text(form, "reason");
  try {
    switch (text(form, "verb")) {
      case "ship": await markShipped.call({ ...sale, carrier: text(form, "carrier") || undefined, tracking: text(form, "tracking") || undefined }, actor); break;
      case "delivered": await confirmDelivery.call(sale, actor); break;
      case "message": await postSaleMessage.call({ ...sale, body: text(form, "body") }, actor); break;
      case "dispute":
        await raiseDispute.call({ ...sale, reason: (DISPUTE_REASONS as readonly string[]).includes(reason) ? (reason as (typeof DISPUTE_REASONS)[number]) : "other", details: text(form, "details") }, actor);
        break;
      case "withdraw": await withdrawDispute.call(sale, actor); break;
      case "review": await leaveReview.call({ ...sale, rating: Number(text(form, "rating")), body: text(form, "body") }, actor); break;
      case "reply": await replyToReview.call({ id: text(form, "reviewId"), body: text(form, "body") }, actor); break;
      default: throw new ServiceError("validation", "Unknown action.");
    }
  } catch (error) {
    if (error instanceof ServiceError) redirect(`${path}?error=${error.code}`);
    throw error;
  }
  redirect(`${path}?saved=1`);
}
