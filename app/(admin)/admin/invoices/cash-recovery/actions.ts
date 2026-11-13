// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// C12.38: thin shared-service callers; posted values never supply money or status.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import { ServiceError } from "@/core/service";
import { merchantRefundSource } from "@/modules/invoicing/merchant-refund-origin";
import { ORIGINAL_CASH_RETURN_CONFIRMATION, ORIGINAL_CASH_STOP_CONFIRMATION } from "@/modules/invoicing/original-cash-recovery-proof";
import { returnOriginalCash, inspectOriginalCashReturn } from "@/modules/invoicing/original-cash-recovery";
import { reviewOriginalCashCallerStopped, reviewOriginalCashLegacyFeeStopped } from "@/modules/invoicing/original-cash-recovery-service";
import { reconcileOriginalPartialCashReturn } from "@/modules/invoicing/original-cash-partial";
import { reviewOriginalUnassignedCash } from "@/modules/invoicing/original-cash-unassigned-service";
import { ORIGINAL_PARTIAL_CASH_CONFIRMATION, ORIGINAL_UNASSIGNED_CASH_CONFIRMATION } from "@/modules/invoicing/original-cash-partial-contract";
const path = "/admin/invoices/cash-recovery";
const field = (form: FormData, key: string) => { const value = form.get(key); return typeof value === "string" ? value : ""; };
export async function originalCashRecoveryAction(form: FormData) {
  const actor = { ...await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value), request: requestMetadataFromHeaders(await headers()) };
  try {
    const intent = field(form, "intent");
    if (intent === "return") {
      const source = merchantRefundSource.parse(field(form, "sourceKind") === "subscription"
        ? { kind: "subscription", receiptId: field(form, "sourceId"), observationId: field(form, "observationId") }
        : { kind: "payment", paymentId: field(form, "sourceId"), ...(field(form, "observationId") ? { observationId: field(form, "observationId") } : {}) });
      if (field(form, "confirmation") !== ORIGINAL_CASH_RETURN_CONFIRMATION) throw new ServiceError("validation", "Confirm only this original cash return.");
      await returnOriginalCash.call({ source, confirmation: ORIGINAL_CASH_RETURN_CONFIRMATION }, actor);
    } else if(intent==="partial") {
      if(field(form,"confirmation")!==ORIGINAL_PARTIAL_CASH_CONFIRMATION)throw new ServiceError("validation","Confirm only these actual original returned parts.");
      await reconcileOriginalPartialCashReturn.call({paymentId:field(form,"paymentId"),confirmation:ORIGINAL_PARTIAL_CASH_CONFIRMATION},actor);
    } else if(intent==="reviewUnassigned") {
      if(field(form,"confirmation")!==ORIGINAL_UNASSIGNED_CASH_CONFIRMATION)throw new ServiceError("validation","Review the actual original bank receipt before confirming its cash ownership.");
      await reviewOriginalUnassignedCash.call({recoveryId:field(form,"recoveryId"),operationId:field(form,"operationId"),rawFactId:field(form,"rawFactId"),confirmation:ORIGINAL_UNASSIGNED_CASH_CONFIRMATION},actor);
    } else if (intent === "inspect") await inspectOriginalCashReturn.call({ recoveryId: field(form, "recoveryId") }, actor);
    else if (intent === "stop" || intent === "legacyFeeStop") {
      if (field(form, "confirmation") !== ORIGINAL_CASH_STOP_CONFIRMATION) throw new ServiceError("validation", "Review the actual original hosting stop before confirming.");
      const common = { expectedDigest: field(form, "expectedDigest"), hostingEvidence: field(form, "hostingEvidence"), confirmation: ORIGINAL_CASH_STOP_CONFIRMATION } as const;
      if (intent === "stop") await reviewOriginalCashCallerStopped.call({ ...common, operationId: field(form, "operationId"), callerId: field(form, "callerId") }, actor);
      else await reviewOriginalCashLegacyFeeStopped.call({ ...common, recoveryId: field(form, "recoveryId"), feeOperationId: field(form, "feeOperationId") }, actor);
    } else throw new ServiceError("validation", "Choose an original cash recovery action.");
  } catch (error) {
    if (error instanceof ServiceError && error.code === "step_up_required") redirect(`/security/verify?returnTo=${encodeURIComponent(path)}`);
    redirect(`${path}?error=${encodeURIComponent(error instanceof ServiceError ? error.code : "failed")}`);
  }
  revalidatePath(path); redirect(`${path}?saved=1`);
}
