// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { decimalToMinor } from "@/adapters/payments/currency";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import { ServiceError } from "@/core/service";
import { recordCommercialFee, reviewCommercialPayment } from "@/modules/invoicing/commercial-attestations";
import { requireStaffActor } from "../../../guard";

export async function recordCommercialFeeAction(form: FormData): Promise<void> {
  const field = (name: string) => { const value = form.get(name); return typeof value === "string" ? value.trim() : ""; };
  const paymentId = field("paymentId");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paymentId)) redirect("/admin/payments?error=validation");
  const path = `/admin/payments/${paymentId}/recorded`;
  const actor = { ...await requireStaffActor("invoicing", "manage"), request: requestMetadataFromHeaders(await headers()) };
  try {
    if (field("confirm") !== "yes") throw new ServiceError("validation", "Confirm that this external money movement actually happened.");
    const original = await reviewCommercialPayment.call({ paymentId }, actor);
    await recordCommercialFee.call({ paymentId, amountMinor: decimalToMinor(field("amount"), original.currency), direction: field("direction"),
      originalRemittanceId: field("originalRemittanceId") || undefined, reference: field("reference"), evidence: field("evidence"), idempotencyKey: field("idempotencyKey") }, actor);
  } catch (error) {
    const code = error instanceof ServiceError && ["validation", "permission", "conflict", "not_found", "rate_limited"].includes(error.code) ? error.code : "failed";
    redirect(`${path}?error=${code}`);
  }
  redirect(`${path}?saved=recorded`);
}
