// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.25: customer capabilities never widen the owner's scoped money services.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { paymentAdapter } from "@/adapters/payments";
import { contacts } from "@/core/contacts/schema";
import { env } from "@/core/env";
import { formatMoney, translator } from "@/core/i18n";
import { localeForContact, localizeCustomerHref } from "@/core/i18n/customer";
import { sendMail } from "@/core/mail/service";
import { contactForActor } from "@/core/portal/service";
import { actorString, defineOrchestratedService, defineService, ServiceError, type ServiceContext } from "@/core/service";
import { checkoutSession, invoiceRow, paymentRow } from "./contract";
import { createPayment, failPayment, markInvoiceViewed, settlePayment, startPayment } from "./invoice-service";
import { invoiceLines, invoices, payments } from "./schema";
import { customerInvoicePath, invoiceAccessToken, paymentReturnToken, validInvoiceToken, validPaymentReturnToken } from "./customer-tokens";

const access = z.object({ id: z.string().uuid(), token: z.string().max(200).optional() }).strict();
const receiptAccess = z.object({ token: z.string().min(1).max(200) }).strict();
const payable = (invoice: typeof invoices.$inferSelect) =>
  ["sent", "viewed", "partially_paid", "overdue"].includes(invoice.status) && invoice.totalMinor > invoice.paidMinor;
const unavailable = () => new ServiceError("not_found", "That invoice link is not available.");

async function authorizedInvoice(input: z.infer<typeof access>, ctx: ServiceContext) {
  const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, input.id)).limit(1);
  if (!invoice?.number || !invoice.issuedAt) throw unavailable();
  if (input.token !== undefined) {
    // Paid/void/refunded invoices retire the email capability. A session can
    // still read its own historic invoice, with no ability to pay it again.
    if (!payable(invoice) || !validInvoiceToken(invoice, input.token)) throw unavailable();
  } else {
    const contact = await contactForActor(ctx).catch((error: unknown) => {
      if (error instanceof ServiceError && ["permission", "not_found"].includes(error.code)) throw unavailable();
      throw error;
    });
    if (contact.id !== invoice.contactId) throw unavailable();
  }
  return invoice;
}

const customerInvoice = z.object({
  id: z.string().uuid(), number: z.string(), status: z.string(), currency: z.string(),
  subtotalMinor: z.number().int(), discountMinor: z.number().int(), shippingMinor: z.number().int(),
  taxMinor: z.number().int(), totalMinor: z.number().int(), paidMinor: z.number().int(),
  dueAt: z.date().nullable(), memo: z.string().nullable(), requiredTaxLegend: z.string().nullable(),
  lines: z.array(z.object({ id: z.string(), description: z.string(), quantityMicros: z.number().int(), totalMinor: z.number().int() })),
  canPay: z.boolean(), paymentMode: z.enum(["hosted", "manual", "unavailable"]),
});

export const getCustomerInvoice = defineService({
  name: "invoicing.customerInvoice", summary: "Read your own issued invoice using a customer session or its private link.",
  kind: "query", permission: "public", input: access, output: customerInvoice,
  handler: async (input, ctx) => {
    const invoice = await authorizedInvoice(input, ctx);
    const lines = await ctx.tx.select({ id: invoiceLines.id, description: invoiceLines.description,
      quantityMicros: invoiceLines.quantityMicros, totalMinor: invoiceLines.totalMinor })
      .from(invoiceLines).where(eq(invoiceLines.invoiceId, invoice.id)).orderBy(asc(invoiceLines.position));
    const adapter = paymentAdapter();
    return { id: invoice.id, number: invoice.number!, status: invoice.status, currency: invoice.currency,
      subtotalMinor: invoice.subtotalMinor, discountMinor: invoice.discountMinor, shippingMinor: invoice.shippingMinor,
      taxMinor: invoice.taxMinor, totalMinor: invoice.totalMinor, paidMinor: invoice.paidMinor,
      dueAt: invoice.dueAt, memo: invoice.memo, requiredTaxLegend: invoice.requiredTaxLegend, lines, canPay: payable(invoice),
      paymentMode: !adapter.status.available || adapter.id === "none" ? "unavailable" as const :
        adapter.id === "manual" ? "manual" as const : "hosted" as const };
  },
});

export const viewCustomerInvoice = defineService({
  name: "invoicing.viewCustomerInvoice", summary: "Record the first authorized customer view without changing the amount owed.",
  kind: "mutation", permission: "public", input: access, output: z.object({ viewed: z.boolean() }),
  handler: async (input, ctx) => {
    const invoice = await authorizedInvoice(input, ctx);
    if (payable(invoice) && !invoice.viewedAt) await ctx.callAsSystem(markInvoiceViewed, { id: invoice.id });
    return { viewed: true };
  },
});

export const sendInvoice = defineService({
  name: "invoicing.send", summary: "Queue an issued invoice's private payment link for its contact.",
  kind: "mutation", permission: "scoped", writeClass: "message",
  input: z.object({ id: z.string().uuid(), idempotencyKey: z.string().min(1).max(100) }),
  output: z.object({ deliveryId: z.string(), delivers: z.boolean() }),
  handler: async (input, ctx) => {
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, input.id)).limit(1);
    if (!invoice?.number || !payable(invoice)) throw unavailable();
    const [contact] = await ctx.tx.select().from(contacts).where(eq(contacts.id, invoice.contactId)).limit(1);
    if (!contact?.email) throw new ServiceError("validation", "This contact needs an email address.");
    const policy = await localeForContact(ctx.tx, contact.id);
    const locale = policy.locale;
    const t = translator(locale);
    const link = new URL(localizeCustomerHref(customerInvoicePath(invoice.id, invoiceAccessToken(invoice)), locale, policy), env().APP_URL).href;
    const delivery = await sendMail(ctx.tx, {
      to: contact.email, subject: t("customerInvoice.emailSubject", { number: invoice.number }),
      text: `${t("customerInvoice.emailBody", { number: invoice.number, amount: formatMoney(invoice.totalMinor - invoice.paidMinor, invoice.currency, locale) })}\n\n${link}\n\n${t("customerInvoice.privateLink")}`,
    }, { requestedBy: actorString(ctx.actor), idempotencyKey: `invoice:${invoice.id}:${input.idempotencyKey}` });
    ctx.setSubject("invoice", invoice.id);
    await ctx.emitTimeline({ contactId: invoice.contactId, eventType: "invoice.emailQueued", subjectType: "invoice", subjectId: invoice.id, payload: { deliveryId: delivery.id } });
    return { deliveryId: delivery.id, delivers: delivery.delivers };
  },
});

const checkoutSource = z.object({ invoice: invoiceRow, payment: paymentRow.nullable(), email: z.string(), name: z.string() });
export const claimCustomerCheckout = defineService({
  name: "invoicing.claimCustomerCheckout", summary: "Authorize and durably reserve a customer payment before contacting its provider.",
  kind: "mutation", permission: "public", external: false, input: access, output: checkoutSource,
  handler: async (input, ctx) => {
    // Serialize only customer claims; preserve the shared ledger's own lock
    // order (payment idempotency, then invoice) to avoid cross-flow deadlocks.
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`customer-checkout:${input.id}`}))`);
    const invoice = await authorizedInvoice(input, ctx);
    if (!payable(invoice)) throw new ServiceError("conflict", "This invoice is not open for payment.");
    const adapter = paymentAdapter();
    if (!adapter.status.available || adapter.id === "none") throw new ServiceError("conflict", "Online payment is not available.");
    const [contact] = await ctx.tx.select().from(contacts).where(eq(contacts.id, invoice.contactId)).limit(1);
    if (!contact?.email) throw new ServiceError("validation", "This contact needs an email address.");
    // One retry identity per outstanding balance. Double-clicks and retries
    // cannot create a second charge for the same balance. Offline instructions
    // create no pretend payment; only the owner's evidence enters the ledger.
    const terminalAttempts = await ctx.tx.select({ id: payments.id }).from(payments).where(and(
      eq(payments.invoiceId, invoice.id), eq(payments.provider, adapter.id),
      inArray(payments.status, ["failed", "cancelled"]),
    ));
    const activeAttempts = await ctx.tx.select().from(payments).where(and(
      eq(payments.invoiceId, invoice.id),
      inArray(payments.status, ["created", "processing"]),
    ));
    const active = activeAttempts.find((entry) =>
      entry.metadata && typeof entry.metadata === "object" && "customerCheckout" in entry.metadata && entry.metadata.customerCheckout === true);
    if (active && (active.provider !== adapter.id || active.amountMinor !== invoice.totalMinor - invoice.paidMinor)) {
      throw new ServiceError("conflict", "A previous payment attempt needs the business to check it before you try again.");
    }
    const payment = adapter.id === "manual" ? null : active ?? await ctx.callAsSystem(createPayment, {
      invoiceId: invoice.id, provider: adapter.id, method: "hosted_checkout",
      amountMinor: invoice.totalMinor - invoice.paidMinor,
      idempotencyKey: `customer-invoice:${invoice.id}:${invoice.paidMinor}:${terminalAttempts.length}`,
      metadata: { customerCheckout: true, customerEmail: contact.email, customerName: contact.name },
    });
    const savedCustomer = z.object({ customerEmail: z.string(), customerName: z.string() }).safeParse(payment?.metadata);
    return { invoice, payment, email: savedCustomer.success ? savedCustomer.data.customerEmail : contact.email,
      name: savedCustomer.success ? savedCustomer.data.customerName : contact.name };
  },
});

const applyCheckoutInput = access.extend({ paymentId: z.string().uuid(), response: checkoutSession });
export const applyCustomerCheckout = defineService({
  name: "invoicing.applyCustomerCheckout", summary: "Attach a provider checkout to its authorized customer payment.",
  kind: "mutation", permission: "public", external: false, input: applyCheckoutInput, output: z.object({ url: z.string().url() }),
  handler: async (input, ctx) => {
    // Recheck after provider I/O: ownership, voiding and settlement can change.
    const invoice = await authorizedInvoice({ id: input.id, token: input.token }, ctx);
    const [payment] = await ctx.tx.select().from(payments).where(and(eq(payments.id, input.paymentId), eq(payments.invoiceId, invoice.id))).limit(1);
    if (!payment || !payable(invoice) || invoice.totalMinor - invoice.paidMinor !== payment.amountMinor) throw new ServiceError("conflict", "The invoice balance changed. Open the invoice again.");
    await ctx.callAsSystem(startPayment, { id: payment.id, providerRef: input.response.paymentRef ?? input.response.providerRef, providerCheckoutRef: input.response.providerRef });
    const url = new URL(input.response.url);
    if (url.protocol !== "https:" || url.username || url.password) throw new ServiceError("conflict", "The payment provider returned an unsafe checkout address.");
    await ctx.tx.update(payments).set({ metadata: {
      ...(payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {}),
      checkoutUrl: url.href, checkoutExpiresAt: input.response.expiresAt ?? null,
    } }).where(eq(payments.id, payment.id));
    return { url: url.href };
  },
});

export const beginCustomerCheckout = defineOrchestratedService({
  name: "invoicing.beginCustomerCheckout", summary: "Open the configured provider checkout for your invoice, or show offline payment instructions.",
  kind: "mutation", permission: "public", writeClass: "money", input: access, output: z.object({ url: z.string().url() }),
  rateLimit: { limit: 20, windowSeconds: 60, subject: (input: z.infer<typeof access>) => `invoice-checkout:${input.id}`, message: "Please wait before trying payment again." },
  handler: async (input, actor) => {
    const source = await claimCustomerCheckout.call(input, actor);
    // The same payment has the same provider request whether entered through
    // a session or an email, so provider idempotency survives either entry.
    const cancel = new URL(customerInvoicePath(input.id, invoiceAccessToken(source.invoice)), env().APP_URL);
    if (!source.payment) {
      cancel.searchParams.set("checkout", "offline");
      return { url: cancel.href };
    }
    const payment = source.payment;
    const successUrl = new URL(`/portal/invoices/confirmation/${paymentReturnToken(payment)}`, env().APP_URL).href;
    if (payment.status === "created" && Date.now() - payment.createdAt.getTime() > 23 * 60 * 60 * 1000) {
      // Bound recovery of unanswered requests. Old ambiguous attempts need
      // owner reconciliation before any further provider request.
      throw new ServiceError("conflict", "This payment attempt needs the business to check it before you try again.");
    }
    const stored = z.object({ checkoutUrl: z.string().url(), checkoutExpiresAt: z.string().datetime().nullable() }).safeParse(payment.metadata);
    if (payment.status === "processing" && stored.success) {
      // Once attached, reuse the original URL even after the provider's
      // idempotency retention window. An expired checkout goes to its status
      // check rather than creating an untracked second provider session.
      return { url: stored.data.checkoutExpiresAt && new Date(stored.data.checkoutExpiresAt) <= new Date()
        ? successUrl : stored.data.checkoutUrl };
    }
    cancel.searchParams.set("checkout", "cancelled");
    try {
      const checkout = await paymentAdapter(payment.provider).createCheckout({
        invoiceId: source.invoice.id, invoiceNumber: source.invoice.number!, contactId: source.invoice.contactId,
        currency: payment.currency, amountMinor: payment.amountMinor, description: `Invoice ${source.invoice.number}`,
        customer: { email: source.email, name: source.name }, successUrl, cancelUrl: cancel.href,
        idempotencyKey: payment.idempotencyKey,
      });
      return await applyCustomerCheckout.call({ ...input, paymentId: payment.id, response: checkout }, actor);
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      // Keep the durable attempt and its retry identity when the provider may
      // have accepted the request. Never mint another charge after a timeout.
      throw new ServiceError("conflict", "Payment could not be opened. Please try again.");
    }
  },
});

async function authorizedPayment(token: string, ctx: ServiceContext) {
  const id = token.split(".")[0];
  if (!z.string().uuid().safeParse(id).success) throw unavailable();
  const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, id!)).limit(1);
  if (!payment || !validPaymentReturnToken(payment, token)) throw unavailable();
  return payment;
}
const receipt = z.object({ status: paymentRow.shape.status, currency: z.string(), amountMinor: z.number().int() });
const receiptView = (payment: typeof payments.$inferSelect) => ({ status: payment.status, currency: payment.currency, amountMinor: payment.amountMinor });
export const customerPaymentReceipt = defineService({
  name: "invoicing.customerPaymentReceipt", summary: "Read only the payment status and amount from its private provider-return link.",
  kind: "query", permission: "public", input: receiptAccess, output: receipt,
  handler: async (input, ctx) => receiptView(await authorizedPayment(input.token, ctx)),
});
export const customerPaymentSource = defineService({
  name: "invoicing.customerPaymentSource", summary: "Authorize a customer provider-status check.",
  kind: "query", permission: "public", external: false, input: receiptAccess, output: paymentRow,
  handler: async (input, ctx) => authorizedPayment(input.token, ctx),
});
const capture = z.object({ providerRef: z.string().min(1), status: z.enum(["pending", "succeeded", "failed"]), amountMinor: z.number().int().optional(), currency: z.string().optional(), occurredAt: z.string().datetime().optional() });
export const applyCustomerPayment = defineService({
  name: "invoicing.applyCustomerPayment", summary: "Converge verified provider results through the shared payment ledger.",
  kind: "mutation", permission: "public", external: false, input: receiptAccess.extend({ response: capture }), output: receipt,
  handler: async (input, ctx) => {
    const payment = await authorizedPayment(input.token, ctx);
    if (payment.status === "succeeded") return payment;
    const result = input.response;
    if ((result.amountMinor !== undefined && result.amountMinor !== payment.amountMinor) ||
        (result.currency !== undefined && result.currency !== payment.currency)) throw new ServiceError("conflict", "The payment provider amount does not match the invoice.");
    if (result.status === "succeeded") return ctx.callAsSystem(settlePayment, { id: payment.id, providerRef: result.providerRef, processedAt: result.occurredAt ? new Date(result.occurredAt) : new Date() });
    if (result.status === "failed") return ctx.callAsSystem(failPayment, { id: payment.id, code: "provider_failed", message: "The payment provider declined this payment." });
    return payment;
  },
});
export const confirmCustomerPayment = defineOrchestratedService({
  name: "invoicing.confirmCustomerPayment", summary: "Confirm a returned checkout with the provider; a browser redirect never proves payment.",
  kind: "mutation", permission: "public", writeClass: "money", input: receiptAccess, output: receipt,
  rateLimit: { limit: 20, windowSeconds: 60, subject: (input: z.infer<typeof receiptAccess>) => `invoice-receipt:${input.token.split(".")[0]}`, message: "Please wait before checking payment again." },
  handler: async (input, actor) => {
    const payment = await customerPaymentSource.call(input, actor);
    if (payment.status === "succeeded" || payment.status === "failed" || payment.status === "cancelled") return receiptView(payment);
    if (!payment.providerCheckoutRef) throw new ServiceError("conflict", "This payment is not ready to confirm.");
    try {
      const response = await paymentAdapter(payment.provider).captureCheckout({ checkoutRef: payment.providerCheckoutRef, idempotencyKey: `customer-confirm:${payment.id}` });
      return await applyCustomerPayment.call({ ...input, response }, actor);
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError("conflict", "Payment could not be checked. Please try again.");
    }
  },
});

export default [getCustomerInvoice, viewCustomerInvoice, sendInvoice, claimCustomerCheckout, applyCustomerCheckout,
  beginCustomerCheckout, customerPaymentReceipt, customerPaymentSource, applyCustomerPayment, confirmCustomerPayment];
