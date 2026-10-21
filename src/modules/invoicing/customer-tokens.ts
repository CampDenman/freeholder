// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.25: separate capabilities for an open invoice and a payment return.
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/core/env";

function signature(purpose: string, identity: string): string {
  const secret = env().SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for invoice links.");
  return createHmac("sha256", secret).update(`freeholder:${purpose}:v1:${identity}`).digest("hex");
}

function equal(candidate: string, expected: string): boolean {
  return /^[a-f0-9]{64}$/.test(candidate) && timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(expected, "hex"));
}

type InvoiceIdentity = { id: string; contactId: string; issuedAt: Date | null };
export function invoiceAccessToken(invoice: InvoiceIdentity): string {
  return signature("invoice-access", `${invoice.id}:${invoice.contactId}:${invoice.issuedAt?.toISOString()}`);
}
export function validInvoiceToken(invoice: InvoiceIdentity, token: string): boolean {
  return equal(token, invoiceAccessToken(invoice));
}

type PaymentIdentity = { id: string; createdAt: Date };
export function paymentReturnToken(payment: PaymentIdentity): string {
  return `${payment.id}.${signature("invoice-payment-return", `${payment.id}:${payment.createdAt.toISOString()}`)}`;
}
export function validPaymentReturnToken(payment: PaymentIdentity, token: string): boolean {
  const [id, digest, extra] = token.split(".");
  return extra === undefined && id === payment.id &&
    Date.now() - payment.createdAt.getTime() <= 7 * 24 * 60 * 60 * 1000 &&
    equal(digest ?? "", paymentReturnToken(payment).split(".")[1]!);
}

export function customerInvoicePath(id: string, token?: string): string {
  return `/portal/invoices/${encodeURIComponent(id)}${token ? `?token=${encodeURIComponent(token)}` : ""}`;
}

/** C10.26: no credential or payment assertion crosses the app return link. */
export function invoiceAppReturnHref(): string {
  return `freeholder://invoices?instance=${encodeURIComponent(new URL(env().APP_URL).origin)}`;
}
