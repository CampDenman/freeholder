// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for payment plans, late fees, and deposit/balance splits
// (C11.09 F04). Exact arithmetic and the original-invoice immutability rule
// stay in `advanced-money-service.ts`.
import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { decimalToMinor } from "@/adapters/payments/currency";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import { ServiceError } from "@/core/service";
import {
  assessLateFee,
  cancelPaymentPlan,
  createDepositAndBalanceInvoices,
  createPaymentPlan,
} from "@/modules/invoicing/advanced-money-service";

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function currentActor() {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  return { ...actor, request: requestMetadataFromHeaders(await headers()) };
}

function fail(error: unknown, fallback: string): never {
  if (error instanceof ServiceError && error.code === "step_up_required") {
    redirect(`/security/verify?returnTo=${encodeURIComponent(fallback)}`);
  }
  const code = error instanceof ServiceError ? error.code : "failed";
  const destination = fallback.includes("?")
    ? `${fallback}&error=${encodeURIComponent(code)}`
    : `${fallback}?error=${encodeURIComponent(code)}`;
  redirect(destination);
}

function amountMinor(value: string, currency: string): number {
  try {
    return decimalToMinor(value, currency);
  } catch {
    throw new ServiceError("validation", "Enter a valid amount for this currency.");
  }
}

function refresh(path: string): void {
  revalidatePath("/admin/invoices");
  revalidatePath("/admin/payments");
  revalidatePath(path);
}

export async function createPaymentPlanAction(form: FormData): Promise<void> {
  const invoiceId = field(form, "invoiceId");
  const destination = `/admin/invoices/${invoiceId}`;
  try {
    const currency = field(form, "currency").toUpperCase();
    await createPaymentPlan.call(
      {
        invoiceId,
        installments: [1, 2].map((index) => ({
          dueAt: new Date(field(form, `dueAt${index}`)),
          amountMinor: amountMinor(field(form, `amount${index}`), currency),
        })),
        idempotencyKey: field(form, "idempotencyKey") || `admin-plan-${randomUUID()}`,
      },
      await currentActor(),
    );
  } catch (error) {
    fail(error, destination);
  }
  refresh(destination);
  redirect(`${destination}?saved=plan`);
}

export async function cancelPaymentPlanAction(form: FormData): Promise<void> {
  const invoiceId = field(form, "invoiceId");
  const destination = `/admin/invoices/${invoiceId}`;
  try {
    await cancelPaymentPlan.call(
      { id: field(form, "planId"), reason: field(form, "reason") },
      await currentActor(),
    );
  } catch (error) {
    fail(error, destination);
  }
  refresh(destination);
  redirect(`${destination}?saved=planCancelled`);
}

export async function assessLateFeeAction(form: FormData): Promise<void> {
  const invoiceId = field(form, "invoiceId");
  const destination = `/admin/invoices/${invoiceId}`;
  try {
    const currency = field(form, "currency").toUpperCase();
    const grace = field(form, "graceDays");
    await assessLateFee.call(
      {
        invoiceId,
        terms: { basis: "fixed", fixedMinor: amountMinor(field(form, "amount"), currency) },
        graceDays: grace ? Number(grace) : 0,
        reason: field(form, "reason"),
        tax: {
          mode: "not_applicable",
          reason: field(form, "taxReason") || "Late-fee invoice uses the same tax treatment as the original.",
        },
        idempotencyKey: field(form, "idempotencyKey") || `admin-late-fee-${randomUUID()}`,
      },
      await currentActor(),
    );
  } catch (error) {
    fail(error, destination);
  }
  refresh(destination);
  redirect(`${destination}?saved=lateFee`);
}

export async function createDepositBalanceAction(form: FormData): Promise<void> {
  const currency = field(form, "currency").toUpperCase();
  try {
    const created = await createDepositAndBalanceInvoices.call(
      {
        contactId: field(form, "contactId"),
        currency,
        sourceType: "manual",
        sourceId: field(form, "sourceId") || randomUUID(),
        deposit: {
          lines: [
            {
              description: field(form, "depositDescription"),
              quantityMicros: 1_000_000,
              unitAmountMinor: amountMinor(field(form, "depositAmount"), currency),
            },
          ],
        },
        balance: {
          lines: [
            {
              description: field(form, "balanceDescription"),
              quantityMicros: 1_000_000,
              unitAmountMinor: amountMinor(field(form, "balanceAmount"), currency),
            },
          ],
        },
        tax: {
          mode: "not_applicable",
          reason: field(form, "taxReason") || "Deposit and balance invoices use the same tax treatment.",
        },
        idempotencyKey: field(form, "idempotencyKey") || `admin-deposit-${randomUUID()}`,
      },
      await currentActor(),
    );
    revalidatePath("/admin/invoices");
    redirect(`/admin/invoices/${created.deposit.id}?saved=deposit`);
  } catch (error) {
    fail(error, "/admin/invoices/new");
  }
}
