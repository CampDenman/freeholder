// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.25: customer capabilities never widen the owner's scoped money services.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { invoiceOutstanding } from "./invoice-balance";
import { paymentAdapter } from "@/adapters/payments";
import { contacts } from "@/core/contacts/schema";
import { env } from "@/core/env";
import { formatMoney, translator } from "@/core/i18n";
import { localeForContact, localizeCustomerHref } from "@/core/i18n/customer";
import { sendMail } from "@/core/mail/service";
import { contactForActor } from "@/core/portal/service";
import { actorString, defineOrchestratedService, defineService, ServiceError, type ServiceContext } from "@/core/service";
import { requiresSavedMethod } from "./checkout-requirements";
import { invoiceRow, paymentRow } from "./contract";
import { assertChargeEvidence, assertProviderAccount, paymentRouting, routingForPayment, verifiedCheckoutSession } from "./merchant-charge";
import { getInvoiceMarketPolicy, verifyInvoiceMerchant } from "./market-policy";
import { invoiceIssuer, publicInvoiceIssuer } from "./merchant-identity";
import { nextCollectionAmount } from "./merchant-collection";
import { invoicePaymentDueAmount } from "./invoice-payment-due";
import { publicInvoiceMerchant, publicInvoiceMerchants, publicPaymentMerchant } from "./merchant-collection-public";
import { merchantObservationRef, merchantPaymentEvidence, recordMerchantPaymentObservation } from "./merchant-payment-observations";
import { originalProviderPlatform } from "./provider-platform-scope";
import { invoiceRefundStateRows, publicRefundState } from "./merchant-refund-bank-state-service";
import { createPayment, failPayment, markInvoiceViewed, settlePayment, startPayment } from "./invoice-service";
import { invoiceLines, invoices, payments, paymentProviderCustomers } from "./schema";
import { customerInvoicePath, invoiceAccessToken, paymentReturnToken, validInvoiceToken, validPaymentReturnToken } from "./customer-tokens";

const access = z.object({ id: z.string().uuid(), token: z.string().max(200).optional() }).strict();
const receiptAccess = z.object({ token: z.string().min(1).max(200) }).strict();
const payable = (invoice: typeof invoices.$inferSelect) =>
  ["sent", "viewed", "partially_paid", "overdue"].includes(invoice.status) && invoice.totalMinor > invoice.paidMinor;
const unavailable = () => new ServiceError("not_found", "That invoice link is not available.");


async function customerCheckoutAmount(invoice: typeof invoices.$inferSelect, ctx: ServiceContext): Promise<number | null> {
  const due = await invoicePaymentDueAmount(invoice, ctx);
  if (due === null) return null;
  const policy = await ctx.callAsSystem(getInvoiceMarketPolicy, { invoiceId: invoice.id });
  if (policy?.collectionVersion !== 1) return due;
  const active = await ctx.tx.select().from(payments).where(and(eq(payments.invoiceId, invoice.id), inArray(payments.status, ["created", "processing"])));
  if (active.length) {
    const payment = active[0]!;
    const routing = await routingForPayment(ctx, payment.id);
    if (active.length !== 1 || !routing.merchantAllocationId || payment.amountMinor > due) throw new ServiceError("conflict", "The existing merchant payment needs reconciliation before another portion can be collected.");
    return payment.amountMinor;
  }
  return (await nextCollectionAmount(ctx, invoice, due))?.amountMinor ?? null;
}

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
  // Only public invoice identity is projected; routing and fees stay private.
  ...publicInvoiceIssuer.shape,
  merchants: z.array(publicInvoiceMerchant),
  subtotalMinor: z.number().int(), discountMinor: z.number().int(), shippingMinor: z.number().int(),
  taxMinor: z.number().int(), totalMinor: z.number().int(), paidMinor: z.number().int(),
  dueAt: z.date().nullable(), memo: z.string().nullable(), requiredTaxLegend: z.string().nullable(),
  // `amountMinor` is the line's share of the subtotal (before discount and
  // before tax — the invoice subtotal sums exactly these, and the discount is
  // its own row beneath it), so the lines add up to the subtotal printed under
  // them. `totalMinor`
  // includes the line's tax and stays for API readers that already use it; a
  // page that lists it beside a pre-tax subtotal shows tax twice (2026-10-23
  // pre-launch check: CA$106.40 on the line, CA$95.00 + CA$11.40 below).
  lines: z.array(z.object({ id: z.string(), description: z.string(), quantityMicros: z.number().int(),
    amountMinor: z.number().int(), totalMinor: z.number().int() })),
  saveMethodRequired: z.boolean(),
  canPay: z.boolean(), paymentMode: z.enum(["hosted", "manual", "unavailable"]),
  nextPaymentMinor: z.number().int().nullable(),
  awaitingRelease: z.boolean(),
  refunds: z.array(publicRefundState),
});

export const getCustomerInvoice = defineService({
  name: "invoicing.customerInvoice", summary: "Read your own issued invoice using a customer session or its private link.",
  kind: "query", permission: "public", input: access, output: customerInvoice,
  handler: async (input, ctx) => {
    const invoice = await authorizedInvoice(input, ctx);
    const lines = (await ctx.tx.select({ id: invoiceLines.id, description: invoiceLines.description,
      quantityMicros: invoiceLines.quantityMicros, amountMinor: invoiceLines.subtotalMinor,
      totalMinor: invoiceLines.totalMinor })
      .from(invoiceLines).where(eq(invoiceLines.invoiceId, invoice.id)).orderBy(asc(invoiceLines.position)));
    const policy = await ctx.callAsSystem(getInvoiceMarketPolicy, { invoiceId: invoice.id });
    const direct = policy?.model === "seller_merchant";
    const issuer = invoiceIssuer(policy);
    const adapter = paymentAdapter(direct ? "stripe" : undefined);
    let merchantAvailable = !direct || adapter.capabilities().sellerMerchantCharges === true;
    if (direct && merchantAvailable) {
      // Keep the original invoice readable when collection needs review.
      try { await verifyInvoiceMerchant(invoice.id, ctx); }
      catch (error) {
        if (error instanceof ServiceError && error.code === "conflict") merchantAvailable = false;
        else throw error;
      }
    }
    const nextPaymentMinor = payable(invoice) ? await customerCheckoutAmount(invoice, ctx) : null;
    return { id: invoice.id, number: invoice.number!, status: invoice.status, currency: invoice.currency, ...issuer,
      merchants: policy?.collectionVersion === 1 ? await publicInvoiceMerchants(ctx, invoice.id) : [],
      subtotalMinor: invoice.subtotalMinor, discountMinor: invoice.discountMinor, shippingMinor: invoice.shippingMinor,
      taxMinor: invoice.taxMinor, totalMinor: invoice.totalMinor, paidMinor: invoice.paidMinor,
      dueAt: invoice.dueAt, memo: invoice.memo, requiredTaxLegend: invoice.requiredTaxLegend, lines, canPay: nextPaymentMinor !== null,
      saveMethodRequired: await requiresSavedMethod(ctx, invoice),
      nextPaymentMinor, awaitingRelease: payable(invoice) && nextPaymentMinor === null,
      refunds: (await invoiceRefundStateRows(ctx, invoice.id)).map(refund => publicRefundState.parse(refund)),
      paymentMode: !merchantAvailable || !adapter.status.available || adapter.id === "none" ? "unavailable" as const :
        adapter.id === "manual" ? "manual" as const : "hosted" as const };
  },
});

/** C10.26: the system browser has no app session; give it only this invoice. */
export const customerInvoiceLink = defineService({
  name: "invoicing.customerInvoiceLink",
  summary: "Open your own payable invoice in a browser without sharing your session.",
  kind: "query", permission: "authenticated", mcpExclude: true, agentCallable: false,
  input: z.object({ id: z.string().uuid() }).strict(),
  output: z.object({ href: z.string().nullable() }),
  handler: async (input, ctx) => {
    const invoice = await authorizedInvoice(input, ctx);
    return { href: payable(invoice) ? customerInvoicePath(invoice.id, invoiceAccessToken(invoice)) : null };
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
    const dueNow = await customerCheckoutAmount(invoice, ctx);
    if (dueNow === null) throw new ServiceError("conflict", "The next payment has not been released by the business yet.");
    const policy = await localeForContact(ctx.tx, contact.id);
    const locale = policy.locale;
    const t = translator(locale);
    const link = new URL(localizeCustomerHref(customerInvoicePath(invoice.id, invoiceAccessToken(invoice)), locale, policy), env().APP_URL).href;
    const delivery = await sendMail(ctx.tx, {
      to: contact.email, subject: t("customerInvoice.emailSubject", { number: invoice.number }),
      text: `${t("customerInvoice.emailBody", { number: invoice.number, amount: formatMoney(dueNow, invoice.currency, locale) })}\n\n${link}\n\n${t("customerInvoice.privateLink")}`,
    }, { requestedBy: actorString(ctx.actor), idempotencyKey: `invoice:${invoice.id}:${input.idempotencyKey}`, transactionalReason: "account_notice" });
    ctx.setSubject("invoice", invoice.id);
    await ctx.emitTimeline({ contactId: invoice.contactId, eventType: "invoice.emailQueued", subjectType: "invoice", subjectId: invoice.id, payload: { deliveryId: delivery.id } });
    return { deliveryId: delivery.id, delivers: delivery.delivers };
  },
});

const checkoutAccess = access.extend({ saveMethodConsent: z.boolean().default(false) });
const checkoutSource = z.object({ invoice: invoiceRow, payment: paymentRow.nullable(), email: z.string(), name: z.string(), routing: paymentRouting, providerCustomerRef: z.string().nullable() });
export const claimCustomerCheckout = defineService({
  name: "invoicing.claimCustomerCheckout", summary: "Authorize and durably reserve a customer payment before contacting its provider.",
  kind: "mutation", permission: "public", external: false, input: checkoutAccess, output: checkoutSource,
  handler: async (input, ctx) => {
    // Serialize only customer claims; preserve the shared ledger's own lock
    // order (payment idempotency, then invoice) to avoid cross-flow deadlocks.
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`customer-checkout:${input.id}`}))`);
    const invoice = await authorizedInvoice(input, ctx);
    if (!payable(invoice)) throw new ServiceError("conflict", "This invoice is not open for payment.");
    const policy = await ctx.callAsSystem(getInvoiceMarketPolicy, { invoiceId: invoice.id });
    const adapter = paymentAdapter(policy?.model === "seller_merchant" ? "stripe" : undefined);
    const saveMethod = await requiresSavedMethod(ctx, invoice);
    if (saveMethod && (!input.saveMethodConsent || !adapter.capabilities().savedMethods || adapter.id === "manual")) {
      throw new ServiceError("conflict", "This membership requires consent and a provider that supports saved payment methods.");
    }
    if (!adapter.status.available || adapter.id === "none") throw new ServiceError("conflict", "Online payment is not available.");
    const [contact] = await ctx.tx.select().from(contacts).where(eq(contacts.id, invoice.contactId)).limit(1);
    if (!contact?.email) throw new ServiceError("validation", "This contact needs an email address.");
    const amountMinor = await customerCheckoutAmount(invoice, ctx);
    if (amountMinor === null) throw new ServiceError("conflict", "The next payment has not been released by the business yet.");
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
    if (activeAttempts.some((entry) => entry.id !== active?.id)) {
      throw new ServiceError("conflict", "Another payment attempt needs the business to check it before you try again.");
    }
    if (active && (active.provider !== adapter.id || active.amountMinor !== amountMinor)) {
      throw new ServiceError("conflict", "A previous payment attempt needs the business to check it before you try again.");
    }
    const payment = adapter.id === "manual" ? null : active ?? await ctx.callAsSystem(createPayment, {
      invoiceId: invoice.id, provider: adapter.id, method: "hosted_checkout",
      amountMinor,
      idempotencyKey: `customer-invoice:${invoice.id}:${invoice.paidMinor}:${terminalAttempts.length}`,
      metadata: { customerCheckout: true, customerEmail: contact.email, customerName: contact.name, saveMethodRequested: saveMethod },
    });
    const savedCustomer = z.object({ customerEmail: z.string(), customerName: z.string() }).safeParse(payment?.metadata);
    const routing = payment ? await routingForPayment(ctx, payment.id) : {};
    const [customer] = await ctx.tx.select().from(paymentProviderCustomers).where(and(eq(paymentProviderCustomers.contactId, invoice.contactId), eq(paymentProviderCustomers.provider, adapter.id), originalProviderPlatform(paymentProviderCustomers.providerPlatformAccountId, routing.providerPlatformAccountId), eq(paymentProviderCustomers.providerAccountId, routing.providerAccountId ?? ""))).limit(1);
    return { routing, providerCustomerRef: customer?.providerCustomerRef ?? null, invoice, payment, email: savedCustomer.success ? savedCustomer.data.customerEmail : contact.email,
      name: savedCustomer.success ? savedCustomer.data.customerName : contact.name };
  },
});

const applyCheckoutInput = access.extend({ paymentId: z.string().uuid(), response: verifiedCheckoutSession });
export const applyCustomerCheckout = defineService({
  name: "invoicing.applyCustomerCheckout", summary: "Attach a provider checkout to its authorized customer payment.",
  kind: "mutation", permission: "public", external: false, input: applyCheckoutInput, output: z.object({ url: z.string().url() }),
  handler: async (input, ctx) => {
    // Recheck after provider I/O: ownership, voiding and settlement can change.
    const invoice = await authorizedInvoice({ id: input.id, token: input.token }, ctx);
    const [payment] = await ctx.tx.select().from(payments).where(and(eq(payments.id, input.paymentId), eq(payments.invoiceId, invoice.id))).limit(1);
    if (!payment || !payable(invoice) || await customerCheckoutAmount(invoice, ctx) !== payment.amountMinor) throw new ServiceError("conflict", "The invoice balance changed. Open the invoice again.");
    assertProviderAccount(await routingForPayment(ctx, payment.id), input.response);
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
  kind: "mutation", permission: "public", writeClass: "money", input: checkoutAccess, output: z.object({ url: z.string().url() }),
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
        paymentAttemptId: payment.id,
        saveMethod: (payment.metadata as { saveMethodRequested?: boolean }).saveMethodRequested === true,
        providerCustomerRef: source.providerCustomerRef ?? undefined,
        ...source.routing,
      });
      return await applyCustomerCheckout.call({ id: input.id, token: input.token, paymentId: payment.id, response: checkout }, actor);
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
const receipt = z.object({ status: paymentRow.shape.status, currency: z.string(), amountMinor: z.number().int(),...publicInvoiceIssuer.shape,
  remainingMinor:z.number().int().min(0).optional(),continueUrl:z.string().nullable().optional(),
});
async function receiptView(payment:typeof payments.$inferSelect,ctx:ServiceContext):Promise<z.output<typeof receipt>>{
  const policy=await ctx.callAsSystem(getInvoiceMarketPolicy,{invoiceId:payment.invoiceId});
  const original={status:payment.status,currency:payment.currency,amountMinor:payment.amountMinor,...(await publicPaymentMerchant(ctx,payment.id) ?? invoiceIssuer(policy))};
  if(policy?.collectionVersion!==1)return original;
  const [invoice]=await ctx.tx.select().from(invoices).where(eq(invoices.id,payment.invoiceId));
  if(!invoice)throw unavailable();
  const language=await localeForContact(ctx.tx,invoice.contactId);
  return{...original,remainingMinor:invoiceOutstanding(invoice),
    continueUrl:payable(invoice)?localizeCustomerHref(customerInvoicePath(invoice.id,invoiceAccessToken(invoice)),language.locale,language):null};
}
export const customerPaymentReceipt = defineService({
  name: "invoicing.customerPaymentReceipt", summary: "Read the original public supplier, payment status and amount from its private provider-return link.",
  kind: "query", permission: "public", input: receiptAccess, output: receipt,
  handler: async (input, ctx) => receiptView(await authorizedPayment(input.token, ctx),ctx),
});
export const customerPaymentSource = defineService({
  name: "invoicing.customerPaymentSource", summary: "Authorize a customer provider-status check.",
  kind: "query", permission: "public", external: false, input: receiptAccess, output: z.object({ payment: paymentRow, routing: paymentRouting }),
  handler: async (input, ctx) => { const payment = await authorizedPayment(input.token, ctx); return { payment, routing: await routingForPayment(ctx, payment.id) }; },
});
const capture = merchantPaymentEvidence;
export const recordCustomerPaymentObservation = defineService({
  name: "invoicing.recordCustomerPaymentObservation", summary: "Authorize and retain the original provider read before applying a customer payment.",
  kind: "mutation", permission: "public", external: false, input: receiptAccess.extend({ response: capture }), output: z.object({ recorded: z.boolean() }),
  handler: async (input, ctx) => {
    const payment = await authorizedPayment(input.token, ctx);
    const routing = await routingForPayment(ctx, payment.id);
    if (!routing.providerPlatformAccountId) return { recorded: false };
    const result = await ctx.callAsSystem(recordMerchantPaymentObservation, { paymentId: payment.id, providerEventRef: merchantObservationRef(input.response), evidence: input.response });
    return { recorded: result.recorded };
  },
});
export const applyCustomerPayment = defineService({
  name: "invoicing.applyCustomerPayment", summary: "Converge verified provider results through the shared payment ledger.",
  kind: "mutation", permission: "public", external: false, input: receiptAccess.extend({ response: capture }), output: receipt,
  handler: async (input, ctx) => {
    const payment = await authorizedPayment(input.token, ctx);
    if (payment.status === "succeeded") return receiptView(payment,ctx);
    const result = input.response;
    const routing = await routingForPayment(ctx, payment.id);
    if (routing.providerPlatformAccountId) {
      if (routing.providerPlatformAccountId !== result.providerPlatformAccountId || (routing.providerAccountId ?? "") !== (result.providerAccountId ?? "")
        || result.amountMinor !== payment.amountMinor || result.currency !== payment.currency || (result.status === "succeeded" && result.customerChargeVerified !== true)) throw new ServiceError("conflict", "The original provider charge needs reconciliation before applying its customer balance.");
      // Its physical observation already committed in a separate transaction.
      // Fee/recipient disagreement remains private settlement debt, without
      // turning an actual paid customer charge into another charge offer.
    } else assertChargeEvidence(routing, result);
    if ((result.amountMinor !== undefined && result.amountMinor !== payment.amountMinor) ||
        (result.currency !== undefined && result.currency !== payment.currency)) throw new ServiceError("conflict", "The payment provider amount does not match the invoice.");
    if (result.status === "succeeded") return receiptView(await ctx.callAsSystem(settlePayment, { id: payment.id, providerRef: result.providerRef, processedAt: result.occurredAt ? new Date(result.occurredAt) : new Date() }),ctx);
    if (result.status === "failed") return receiptView(await ctx.callAsSystem(failPayment, { id: payment.id, code: "provider_failed", message: "The payment provider declined this payment." }),ctx);
    return receiptView(payment,ctx);
  },
});
export const confirmCustomerPayment = defineOrchestratedService({
  name: "invoicing.confirmCustomerPayment", summary: "Confirm a returned checkout with the provider; a browser redirect never proves payment.",
  kind: "mutation", permission: "public", writeClass: "money", input: receiptAccess, output: receipt,
  rateLimit: { limit: 20, windowSeconds: 60, subject: (input: z.infer<typeof receiptAccess>) => `invoice-receipt:${input.token.split(".")[0]}`, message: "Please wait before checking payment again." },
  handler: async (input, actor) => {
    const { payment, routing } = await customerPaymentSource.call(input, actor);
    if (payment.status === "succeeded" || payment.status === "failed" || payment.status === "cancelled") return customerPaymentReceipt.call(input,actor);
    if (!payment.providerCheckoutRef) throw new ServiceError("conflict", "This payment is not ready to confirm.");
    try {
      const response = await paymentAdapter(payment.provider).captureCheckout({ checkoutRef: payment.providerCheckoutRef, idempotencyKey: `customer-confirm:${payment.id}`, paymentAttemptId: payment.id, ...routing });
      if (routing.providerPlatformAccountId) await recordCustomerPaymentObservation.call({ ...input, response }, actor);
      return await applyCustomerPayment.call({ ...input, response }, actor);
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError("conflict", "Payment could not be checked. Please try again.");
    }
  },
});

export default [getCustomerInvoice, customerInvoiceLink, viewCustomerInvoice, sendInvoice, claimCustomerCheckout, applyCustomerCheckout,
  beginCustomerCheckout, customerPaymentReceipt, customerPaymentSource, recordCustomerPaymentObservation, applyCustomerPayment, confirmCustomerPayment];
