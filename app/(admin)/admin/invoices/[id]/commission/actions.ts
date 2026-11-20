// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { decimalToMinor } from "@/adapters/payments/currency";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import { ServiceError } from "@/core/service";
import { recordAgreementFeeRemittance, reviewAgreementFee } from "@/modules/invoicing/agreement-fee-service";
import { requireStaffActor } from "../../../guard";

export async function recordAgreementFeeAction(form: FormData): Promise<void> {
  const field = (name: string) => { const value = form.get(name); return typeof value === "string" ? value.trim() : ""; };
  const invoiceId = field("invoiceId");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoiceId)) redirect("/admin/invoices?error=validation");
  const path = `/admin/invoices/${invoiceId}/commission`;
  const actor = { ...await requireStaffActor("invoicing", "manage"), request: requestMetadataFromHeaders(await headers()) };
  try {
    if (field("confirm") !== "yes") throw new ServiceError("validation", "Confirm that this external money movement actually happened.");
    const original = await reviewAgreementFee.call({ invoiceId }, actor);
    await recordAgreementFeeRemittance.call({ invoiceId, amountMinor: decimalToMinor(field("amount"), original.currency), direction: field("direction"),
      originalRemittanceId: field("originalRemittanceId") || undefined, reference: field("reference"), evidence: field("evidence"), idempotencyKey: field("idempotencyKey") }, actor);
  } catch (error) {
    const code = error instanceof ServiceError && ["validation", "permission", "conflict", "not_found", "rate_limited"].includes(error.code) ? error.code : "failed";
    redirect(`${path}?error=${code}`);
  }
  redirect(`${path}?saved=recorded`);
}
