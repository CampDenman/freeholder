// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin invoice and tax admin callers. Money, tax, and audit stay in the
// invoicing services shared with HTTP and MCP (C5 admin contract).

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
  createCreditNote,
  createDraftInvoice,
  issueCreditNote,
  issueInvoice,
  voidCreditNote,
  voidInvoice,
} from "@/modules/invoicing/invoice-service";
import {
  addTaxRate,
  createTaxCategory,
  createTaxZone,
  installTaxTemplate,
  setTaxExemption,
  setTaxRegistration,
} from "@/modules/invoicing/tax-service";

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function checked(form: FormData, key: string): boolean {
  return field(form, key) === "yes" || field(form, key) === "on";
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

function quantityMicros(value: string): number {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) {
    throw new ServiceError(
      "validation",
      "Quantity must be a positive number with up to six decimal places.",
    );
  }
  const micros = BigInt(match[1]!) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"));
  if (micros <= 0n || micros > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ServiceError("validation", "Quantity is outside the supported range.");
  }
  return Number(micros);
}

function percentToPpm(value: string): number {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,4}))?$/.exec(value);
  if (!match) {
    throw new ServiceError("validation", "Enter a tax rate as a percent with up to four decimal places.");
  }
  const ppm = BigInt(match[1]!) * 10_000n + BigInt((match[2] ?? "").padEnd(4, "0"));
  if (ppm > 10_000_000n) {
    throw new ServiceError("validation", "A tax rate cannot exceed 1000%.");
  }
  return Number(ppm);
}

function optionalNumber(value: string): number | undefined {
  if (!value) return undefined;
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new ServiceError("validation", "Enter a whole number.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ServiceError("validation", "That number is outside the supported range.");
  }
  return parsed;
}

function list(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function refreshInvoices(...paths: string[]): void {
  revalidatePath("/admin/invoices");
  revalidatePath("/admin/payments");
  revalidatePath("/admin/contacts");
  for (const path of paths) revalidatePath(path);
}

export async function invoiceAction(form: FormData): Promise<void> {
  const intent = field(form, "intent");
  const invoiceId = field(form, "id");
  let destination = invoiceId ? `/admin/invoices/${invoiceId}` : "/admin/invoices/new";
  try {
    const actor = await currentActor();
    if (intent === "create") {
      const currency = field(form, "currency").toUpperCase();
      const lines = [0, 1, 2, 3, 4]
        .map((index) => ({
          description: field(form, `description-${index}`),
          quantity: field(form, `quantity-${index}`),
          amount: field(form, `amount-${index}`),
          taxCategoryCode: field(form, `taxCategory-${index}`) || "standard",
        }))
        .filter((line) => line.description);
      if (lines.length === 0) {
        throw new ServiceError("validation", "Add at least one invoice line.");
      }
      const taxMode = field(form, "taxMode");
      const tax =
        taxMode === "calculate"
          ? {
              mode: "calculate" as const,
              origin: {
                country: field(form, "originCountry").toUpperCase(),
                ...(field(form, "originRegion")
                  ? { region: field(form, "originRegion").toUpperCase() }
                  : {}),
                ...(field(form, "originPostal")
                  ? { postalCode: field(form, "originPostal").toUpperCase() }
                  : {}),
              },
              destination: {
                country: field(form, "destinationCountry").toUpperCase(),
                ...(field(form, "destinationRegion")
                  ? { region: field(form, "destinationRegion").toUpperCase() }
                  : {}),
                ...(field(form, "destinationPostal")
                  ? { postalCode: field(form, "destinationPostal").toUpperCase() }
                  : {}),
              },
            }
          : {
              mode: "not_applicable" as const,
              reason: field(form, "taxReason"),
            };
      const created = await createDraftInvoice.call(
        {
          contactId: field(form, "contactId"),
          currency,
          idempotencyKey: field(form, "idempotencyKey") || `admin-invoice-${randomUUID()}`,
          lines: lines.map((line) => ({
            description: line.description,
            quantityMicros: quantityMicros(line.quantity || "1"),
            unitAmountMinor: amountMinor(line.amount, currency),
            taxCategoryCode: line.taxCategoryCode,
          })),
          ...(field(form, "shipping")
            ? { shippingMinor: amountMinor(field(form, "shipping"), currency) }
            : {}),
          ...(field(form, "memo") ? { memo: field(form, "memo") } : {}),
          ...(field(form, "dueAt") ? { dueAt: new Date(field(form, "dueAt")) } : {}),
          tax,
        },
        actor,
      );
      destination = `/admin/invoices/${created.invoice.id}?saved=created`;
    } else if (intent === "issue") {
      await issueInvoice.call(
        {
          id: invoiceId,
          ...(field(form, "dueAt") ? { dueAt: new Date(field(form, "dueAt")) } : {}),
        },
        actor,
      );
      destination = `/admin/invoices/${invoiceId}?saved=issue`;
    } else if (intent === "void") {
      if (field(form, "confirm") !== "yes") {
        throw new ServiceError("validation", "Confirm that this unpaid invoice should be voided.");
      }
      await voidInvoice.call({ id: invoiceId, reason: field(form, "reason") }, actor);
      destination = `/admin/invoices/${invoiceId}?saved=void`;
    } else if (intent === "credit") {
      const currency = field(form, "currency").toUpperCase();
      const created = await createCreditNote.call(
        {
          invoiceId,
          idempotencyKey: field(form, "idempotencyKey") || `admin-credit-${randomUUID()}`,
          reason: field(form, "reason"),
          lines: [
            {
              description: field(form, "description"),
              quantityMicros: quantityMicros(field(form, "quantity") || "1"),
              subtotalMinor: amountMinor(field(form, "subtotal"), currency),
              ...(field(form, "tax")
                ? { taxMinor: amountMinor(field(form, "tax"), currency) }
                : {}),
            },
          ],
        },
        actor,
      );
      destination = `/admin/invoices/${invoiceId}?saved=credit&credit=${created.id}`;
    } else if (intent === "issueCredit") {
      await issueCreditNote.call({ id: field(form, "creditId") }, actor);
      destination = `/admin/invoices/${invoiceId}?saved=issueCredit`;
    } else if (intent === "voidCredit") {
      if (field(form, "confirm") !== "yes") {
        throw new ServiceError("validation", "Confirm that this credit note should be voided.");
      }
      await voidCreditNote.call({ id: field(form, "creditId"), reason: field(form, "reason") }, actor);
      destination = `/admin/invoices/${invoiceId}?saved=voidCredit`;
    } else {
      throw new ServiceError("validation", "Choose an invoice action.");
    }
  } catch (error) {
    fail(error, invoiceId ? `/admin/invoices/${invoiceId}` : "/admin/invoices/new");
  }
  refreshInvoices(destination.split("?")[0]!);
  redirect(destination);
}

export async function taxAction(form: FormData): Promise<void> {
  const intent = field(form, "intent");
  try {
    const actor = await currentActor();
    if (intent === "install") {
      await installTaxTemplate.call(
        {
          key: field(form, "key"),
          ...(field(form, "threshold")
            ? {
                thresholdMinor: amountMinor(
                  field(form, "threshold"),
                  field(form, "thresholdCurrency").toUpperCase(),
                ),
                thresholdCurrency: field(form, "thresholdCurrency").toUpperCase(),
              }
            : {}),
        },
        actor,
      );
    } else if (intent === "category") {
      await createTaxCategory.call(
        {
          code: field(form, "code"),
          name: field(form, "name"),
          ...(field(form, "description") ? { description: field(form, "description") } : {}),
        },
        actor,
      );
    } else if (intent === "zone") {
      await createTaxZone.call(
        {
          name: field(form, "name"),
          country: field(form, "country").toUpperCase(),
          regions: list(field(form, "regions")).map((region) => region.toUpperCase()),
          ...(field(form, "priority") ? { priority: optionalNumber(field(form, "priority")) } : {}),
          basis: field(form, "basis") === "origin" ? "origin" : "destination",
          pricesIncludeTax: checked(form, "pricesIncludeTax"),
          roundingScope: field(form, "roundingScope") === "invoice" ? "invoice" : "line",
          roundingMode: field(form, "roundingMode") === "bankers" ? "bankers" : "half_up",
        },
        actor,
      );
    } else if (intent === "rate") {
      await addTaxRate.call(
        {
          zoneId: field(form, "zoneId"),
          ...(field(form, "categoryId") ? { categoryId: field(form, "categoryId") } : {}),
          name: field(form, "name"),
          jurisdiction: field(form, "jurisdiction"),
          ratePpm: percentToPpm(field(form, "ratePercent")),
          compound: checked(form, "compound"),
          appliesToShipping: checked(form, "appliesToShipping"),
          ...(field(form, "priority") ? { priority: optionalNumber(field(form, "priority")) } : {}),
          ...(field(form, "effectiveFrom") ? { effectiveFrom: field(form, "effectiveFrom") } : {}),
          ...(field(form, "effectiveTo") ? { effectiveTo: field(form, "effectiveTo") } : {}),
        },
        actor,
      );
    } else if (intent === "registration") {
      await setTaxRegistration.call(
        {
          ...(field(form, "id") ? { id: field(form, "id") } : {}),
          zoneId: field(form, "zoneId"),
          status: field(form, "status") as "monitoring" | "active" | "paused" | "closed",
          ...(field(form, "number") ? { number: field(form, "number") } : {}),
          ...(field(form, "scheme")
            ? { scheme: field(form, "scheme") as "standard" | "oss" | "ioss" | "simplified" }
            : {}),
          ...(field(form, "threshold")
            ? {
                thresholdMinor: amountMinor(
                  field(form, "threshold"),
                  field(form, "thresholdCurrency").toUpperCase(),
                ),
                thresholdCurrency: field(form, "thresholdCurrency").toUpperCase(),
              }
            : {}),
          acknowledgeTemplateLimitations: checked(form, "acknowledge"),
        },
        actor,
      );
    } else if (intent === "exemption") {
      await setTaxExemption.call(
        {
          contactId: field(form, "contactId"),
          zoneId: field(form, "zoneId"),
          kind: field(form, "kind") as
            | "reseller"
            | "nonprofit"
            | "reverse_charge"
            | "diplomatic",
          status: field(form, "status") as "pending" | "valid" | "expired" | "revoked",
          ...(field(form, "certificateRef")
            ? { certificateRef: field(form, "certificateRef") }
            : {}),
          ...(field(form, "validatedAt")
            ? { validatedAt: new Date(field(form, "validatedAt")) }
            : {}),
          ...(field(form, "expiresAt") ? { expiresAt: new Date(field(form, "expiresAt")) } : {}),
        },
        actor,
      );
    } else {
      throw new ServiceError("validation", "Choose a tax action.");
    }
  } catch (error) {
    fail(error, "/admin/invoices/tax");
  }
  refreshInvoices("/admin/invoices/tax", "/admin/products");
  redirect(`/admin/invoices/tax?saved=${encodeURIComponent(intent)}`);
}
