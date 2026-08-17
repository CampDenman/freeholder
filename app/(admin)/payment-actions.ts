// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { decimalToMinor } from "@/adapters/payments/currency";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import { ServiceError } from "@/core/service";
import { getInvoice } from "@/modules/invoicing/invoice-service";
import { refundCustomerBalancePayment } from "@/modules/invoicing/advanced-money-service";
import {
  completePaymentCheckout,
  getPayment,
  recordOfflinePayment,
  recordOfflineRefund,
  revokeSavedPaymentMethod,
  submitProviderRefund,
} from "@/modules/invoicing/payment-provider-service";
import { beginInPersonPayment, refundInPersonPayment } from "@/modules/invoicing/pos-service";

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function currentActor() {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  return { ...actor, request: requestMetadataFromHeaders(await headers()) };
}

function confirmed(form: FormData): void {
  if (field(form, "confirm") !== "yes") throw new ServiceError("validation", "Confirm this money action before continuing.");
}

export async function paymentAction(form: FormData): Promise<void> {
  const intent = field(form, "intent");
  try {
    const actor = await currentActor();
    if (intent === "record") {
      confirmed(form);
      const invoiceId = field(form, "invoiceId");
      const bundle = await getInvoice.call({ id: invoiceId }, actor);
      await recordOfflinePayment.call({
        invoiceId,
        method: field(form, "method"),
        amountMinor: decimalToMinor(field(form, "amount"), bundle.invoice.currency),
        reference: field(form, "reference") || undefined,
        evidence: field(form, "evidence"),
        idempotencyKey: field(form, "idempotencyKey"),
      }, actor);
    } else if (intent === "refund") {
      confirmed(form);
      const paymentId = field(form, "paymentId");
      const row = await getPayment.call({ id: paymentId }, actor);
      const input = {
        paymentId,
        amountMinor: decimalToMinor(field(form, "amount"), row.payment.currency),
        reason: field(form, "reason"),
        idempotencyKey: field(form, "idempotencyKey"),
      };
      if (row.payment.provider === "manual") {
        await recordOfflineRefund.call({ ...input, reference: field(form, "reference") || undefined }, actor);
      } else if (row.payment.provider === "balance") {
        await refundCustomerBalancePayment.call(input, actor);
      } else {
        await submitProviderRefund.call(input, actor);
      }
    } else if (intent === "complete") {
      await completePaymentCheckout.call({ paymentId: field(form, "paymentId"), idempotencyKey: field(form, "idempotencyKey") }, actor);
    } else if (intent === "inPerson") {
      confirmed(form);
      const invoiceId = field(form, "invoiceId");
      const bundle = await getInvoice.call({ id: invoiceId }, actor);
      await beginInPersonPayment.call(
        {
          invoiceId,
          locationId: field(form, "locationId"),
          method: field(form, "method") as "cash" | "card_present" | "tap_to_pay",
          amountMinor: decimalToMinor(field(form, "amount"), bundle.invoice.currency),
          ...(field(form, "readerRef") ? { readerRef: field(form, "readerRef") } : {}),
          idempotencyKey: field(form, "idempotencyKey"),
        },
        actor,
      );
    } else if (intent === "inPersonRefund") {
      confirmed(form);
      await refundInPersonPayment.call(
        {
          paymentId: field(form, "paymentId"),
          amountMinor: decimalToMinor(field(form, "amount"), field(form, "currency") || "CAD"),
          reason: field(form, "reason"),
          idempotencyKey: field(form, "idempotencyKey"),
        },
        actor,
      );
    } else if (intent === "revoke") {
      confirmed(form);
      await revokeSavedPaymentMethod.call({ id: field(form, "methodId"), idempotencyKey: field(form, "idempotencyKey") }, actor);
    } else {
      throw new ServiceError("validation", "Choose a payment action.");
    }
  } catch (error) {
    const back = field(form, "returnTo") || "/admin/payments";
    if (error instanceof ServiceError && error.code === "step_up_required") {
      redirect(`/security/verify?returnTo=${encodeURIComponent(back)}`);
    }
    const code = error instanceof ServiceError ? error.code : "failed";
    redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(code)}`);
  }
  revalidatePath("/admin/payments");
  revalidatePath("/admin/pos");
  const back = field(form, "returnTo") || "/admin/payments";
  redirect(`${back}${back.includes("?") ? "&" : "?"}status=${encodeURIComponent(intent)}`);
}
