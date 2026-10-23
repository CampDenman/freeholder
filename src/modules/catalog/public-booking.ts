// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C6.19: public discovery and verified, retry-safe customer reservations.
import { cancellationTerms, NO_POLICY, termsFrom, type CancellationTerms } from "@/core/scheduling/policy";
import { createHash } from "node:crypto";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { actorString, defineService, ServiceError, type ServiceContext } from "@/core/service";
import { contactForActor } from "@/core/portal/service";
import { resolveContact } from "@/core/contacts/service";
import { env } from "@/core/env";
import { anonymousClientKey } from "@/core/security/rate-limit";
import { isFictionalEmail, PLAYGROUND_FICTIONAL_BOOKING_EMAIL } from "@/core/demo/playground-policy";
import { getBusiness } from "@/core/settings/service";
import { availableSlots } from "@/core/scheduling/resolver-service";
import { createBooking, rescheduleBooking } from "@/core/scheduling/bookings";
import { bookings, calendars } from "@/core/scheduling/schema";
import { createDraftInvoice, issueInvoice } from "@/modules/invoicing/invoice-service";
import { createPaymentPlan } from "@/modules/invoicing/advanced-money-service";
import { products as productTable, serviceOfferings } from "./schema";
import { sellerCanSell } from "./market";
import { bookingTerms, getServiceOffering, listPriceRules, quoteServicePayment } from "./offerings";

const selection = z.object({ productId: z.uuid(), currency: z.string().length(3), mode: z.enum(["full", "deposit_balance"]).default("full"), seats: z.number().int().min(1).max(100).default(1) });
/**
 * The fingerprint a booking page carries back with its reservation. It covers
 * the terms in force, which without a policy are still `NO_POLICY`: hashing
 * those rather than `null` keeps the value a page computed before 2026-10-23
 * (when no policy was quoted as `NO_POLICY`) valid, so a page open across that
 * deploy does not fail once with "the price or terms changed".
 */
export function bookingTermsHash(fields: { productId: string; offeringId: string; durationMin: number; capacity: number; offeringUpdatedAt: Date; price: number; due: number; currency: string; mode: string; seats: number; policy: CancellationTerms | null }): string {
  const { policy, ...rest } = fields;
  return createHash("sha256").update(JSON.stringify({ ...rest, policy: policy ?? NO_POLICY })).digest("hex");
}

const quoteOut = z.object({ productId: z.uuid(), offeringId: z.uuid(), name: z.string(), durationMin: z.number().int(), capacity: z.number().int(), currency: z.string(), totalMinor: z.number().int(), dueNowMinor: z.number().int(), balanceMinor: z.number().int(), mode: z.enum(["full", "deposit_balance"]), termsHash: z.string(), policy: cancellationTerms.nullable() });

export const publicBookingQuote = defineService({
  name: "catalog.publicBookingQuote", summary: "The public service price and cancellation promise a customer must accept.", kind: "query", permission: "public", input: selection, output: quoteOut,
  handler: async (input, ctx) => {
    const { listVisibleProducts } = await import("./service");
    const product = (await ctx.call(listVisibleProducts, { limit: 500 })).find(p=>p.id===input.productId && p.kind==="service");
    if (!product) throw new ServiceError("not_found", "That service is not available.");
    const offering = await ctx.call(getServiceOffering, { productId: product.id });
    if (!offering) throw new ServiceError("not_found", "That service is not bookable.");
    const price = await ctx.call(quoteServicePayment, { ...input, quantity: input.seats });
    if (!price.available) throw new ServiceError("conflict", "That service cannot be priced in this currency.");
    // No policy attached is quoted as none, not as a made-up one: the booking
    // page and the appointment page then say the same thing (2026-10-23
    // pre-launch check: "Cancellation and rescheduling policy" on one, "No
    // cancellation policy" on the other). Cancelling still runs on NO_POLICY.
    const attached = await ctx.call(bookingTerms, { serviceOfferingId: offering.id });
    const policy = attached ? termsFrom(attached) : null;
    const hash = bookingTermsHash({ productId: product.id, offeringId: offering.id, durationMin: offering.durationMin, capacity: offering.capacity, offeringUpdatedAt: offering.updatedAt, price: price.priceMinor, due: price.dueNowMinor, currency: input.currency, mode: input.mode, seats: input.seats, policy });
    return { productId: product.id, offeringId: offering.id, name: product.name, durationMin: offering.durationMin, capacity: offering.capacity, currency: input.currency, totalMinor: price.priceMinor, dueNowMinor: price.dueNowMinor, balanceMinor: price.priceMinor-price.dueNowMinor, mode: input.mode, termsHash: hash, policy };
  },
});

export const bookableServices = defineService({
  name: "catalog.bookableServices", summary: "Active public services and their offered booking payment modes — the site's own, or one member's (C12.25).", kind: "query", permission: "public", input: z.object({ sellerUserId: z.uuid().optional() }),
  output: z.object({ currency: z.string(), services: z.array(z.object({ productId: z.uuid(), offeringId: z.uuid(), name: z.string(), durationMin: z.number().int(), modes: z.array(z.enum(["full", "deposit_balance"])) })) }),
  handler: async (input, ctx) => {
    const business = await ctx.call(getBusiness, {});
    const { listVisibleProducts } = await import("./service");
    const listed = (await ctx.call(listVisibleProducts, { limit: 500 })).filter(p=>p.kind==="service");
    // A member's services are booked from their own page, and only while they can be paid.
    const sellers = listed.length ? new Map((await ctx.tx.select({ id: productTable.id, seller: productTable.sellerUserId }).from(productTable).where(inArray(productTable.id, listed.map(p=>p.id)))).map(r=>[r.id, r.seller])) : new Map<string, string | null>();
    const products = listed.filter(p => (sellers.get(p.id) ?? null) === (input.sellerUserId ?? null));
    if (input.sellerUserId && !(await sellerCanSell(ctx, input.sellerUserId))) return { currency: business?.baseCurrency ?? "USD", services: [] };
    const services = [];
    for (const product of products) {
      const offering = await ctx.call(getServiceOffering, { productId: product.id });
      if (!offering) continue;
      const rules = await ctx.call(listPriceRules, { productId: product.id });
      const modes = rules.map(r=>r.mode).filter((m): m is "full" | "deposit_balance" => m==="full" || m==="deposit_balance");
      if (modes.length) services.push({ productId: product.id, offeringId: offering.id, name: product.name, durationMin: offering.durationMin, modes });
    }
    return { currency: business?.baseCurrency ?? "USD", services };
  },
});

/**
 * Who a reservation is for. Normally the signed-in customer, whose email the
 * portal sign-in already proved (C6.19). C1.38: the public playground sends no
 * mail, so that proof can never arrive there; a reserved, undeliverable
 * address (`isFictionalEmail`) stands in as its own proof and resolves through
 * `contacts.resolve`, and a real-looking one is refused so the shared demo
 * never books against somebody's inbox. Outside the playground an address in
 * the input is ignored and an anonymous caller is refused exactly as before.
 */
async function bookingContact(ctx: ServiceContext, input: { email?: string; name?: string }) {
  if (env().FREEHOLDER_PLAYGROUND === "1" && ctx.actor.kind !== "system" && input.email !== undefined) {
    if (!isFictionalEmail(input.email)) throw new ServiceError("validation", PLAYGROUND_FICTIONAL_BOOKING_EMAIL);
    const resolved = await ctx.callAsSystem(resolveContact, { email: input.email, ...(input.name ? { name: input.name } : {}), source: "site_booking" });
    return { contact: resolved.contact, guest: true };
  }
  return { contact: await contactForActor(ctx), guest: false };
}

export const bookPublicService = defineService({
  name: "catalog.bookService", summary: "Reserve a currently available service for the signed-in customer and issue its canonical invoice.", kind: "mutation", permission: "public", writeClass: "money",
  input: selection.extend({ calendarId: z.uuid(), startsAt: z.iso.datetime(), termsHash: z.string().regex(/^[a-f0-9]{64}$/), acceptedTerms: z.literal(true), requestKey: z.uuid(),
    // C1.38: honoured only in the public playground, and only for a made-up address.
    email: z.string().trim().email().toLowerCase().max(320).optional(), name: z.string().trim().min(1).max(200).optional() }),
  rateLimit: { limit: 10, windowSeconds: 60, subject: (_input, actor) => actor.kind === "anonymous" ? `booking-guest:${anonymousClientKey(actor)}` : actorString(actor), message: "Please wait before trying this reservation again." },
  // `manageToken` is a playground guest's own appointment link
  // (/portal/appointments/<token>); a signed-in customer has the portal record.
  output: z.object({ bookingId: z.uuid(), invoiceId: z.uuid().nullable(), manageToken: z.string().nullable() }),
  handler: async (input, ctx) => {
    const { contact, guest } = await bookingContact(ctx, input);
    if (!contact.email) throw new ServiceError("conflict", "Verify your customer email before booking.");
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`booking-request:${contact.id}:${input.requestKey}`}))`);
    const [prior] = await ctx.tx.select().from(bookings).where(and(eq(bookings.contactId, contact.id), eq(bookings.publicRequestKey, input.requestKey))).limit(1);
    if (prior) {
      const priorProduct = await ctx.call(getServiceOffering, { productId: input.productId });
      if (prior.serviceOfferingId !== priorProduct?.id || prior.calendarId !== input.calendarId || prior.startsAt.getTime() !== new Date(input.startsAt).getTime() || prior.capacityUsed !== input.seats || (prior.meta as {publicTermsHash?:string})?.publicTermsHash !== input.termsHash) throw new ServiceError("conflict", "This request was already used for a different reservation.");
      return { bookingId: prior.id, invoiceId: prior.invoiceId, manageToken: guest ? prior.rescheduleToken : null };
    }
    const [owner] = await ctx.tx.select({ seller: productTable.sellerUserId }).from(productTable).where(eq(productTable.id, input.productId)).limit(1);
    if (owner?.seller && !(await sellerCanSell(ctx, owner.seller))) throw new ServiceError("conflict", "This member cannot take bookings yet.");
    const quote = await ctx.call(publicBookingQuote, input);
    if (quote.termsHash !== input.termsHash) throw new ServiceError("conflict", "The price or terms changed. Review them before booking.");
    const business = await ctx.call(getBusiness, {});
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: business?.timezone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(input.startsAt));
    const from = day;
    const to = day;
    const find = async () => (await ctx.call(availableSlots, { productId: input.productId, serviceOfferingId: quote.offeringId, from, to, seats: input.seats, preferredCalendarId: input.calendarId, onlyPreferred: true, limit: 500 })).find(s=>s.calendarId===input.calendarId && s.startsAt.toISOString()===input.startsAt);
    const candidate = await find();
    if (!candidate) throw new ServiceError("conflict", "That time is no longer available. Choose another.");
    // All required calendars share a deterministic lock order. Re-read availability
    // under those locks so buffers, resource capacity and concurrent requests agree.
    await ctx.tx.select({ id: calendars.id }).from(calendars).where(inArray(calendars.id, [candidate.calendarId,...candidate.resourceCalendarIds].sort())).orderBy(calendars.id).for("update");
    const slot = await find();
    if (!slot) throw new ServiceError("conflict", "That time was just taken. Choose another.");
    if (slot.endsAt.getTime() - slot.startsAt.getTime() !== quote.durationMin * 60000) throw new ServiceError("conflict", "The appointment duration changed. Review it before booking.");
    const booking = await ctx.callAsSystem(createBooking, { calendarId: slot.calendarId, contact: { email: contact.email }, serviceOfferingId: quote.offeringId, secondaryCalendarIds: slot.resourceCalendarIds, startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString(), capacityUsed: input.seats, source: "site", status: "requested" });
    let invoiceId: string | null = null;
    if (quote.totalMinor > 0) {
      const business = await ctx.call(getBusiness, {});
      if (!business?.country) throw new ServiceError("conflict", "The business needs its tax location configured before taking bookings.");
      const invoice = await ctx.callAsSystem(createDraftInvoice, { contactId: contact.id, currency: input.currency, sourceType: "booking", sourceId: booking.id, idempotencyKey: `public-booking:${booking.id}`, lines: [{ description: quote.name, quantityMicros: 1000000, unitAmountMinor: quote.totalMinor }], tax: { mode: "calculate", origin: { country: business.country }, destination: { country: business.country } } });
      const issued = await ctx.callAsSystem(issueInvoice, { id: invoice.invoice.id });
      invoiceId = issued.invoice.id;
      const deposit = Math.min(quote.dueNowMinor, issued.invoice.totalMinor);
      if (quote.mode === "deposit_balance" && deposit > 0 && deposit < issued.invoice.totalMinor) await ctx.callAsSystem(createPaymentPlan, { invoiceId: issued.invoice.id, idempotencyKey: `booking-deposit:${booking.id}`, installments: [{ dueAt: new Date(), amountMinor: deposit }, { dueAt: slot.startsAt, amountMinor: issued.invoice.totalMinor-deposit }] });
    }
    const [saved] = await ctx.tx.update(bookings).set({ invoiceId, cancellationPolicy: quote.policy, publicRequestKey: input.requestKey, meta: { publicTermsHash: input.termsHash } }).where(eq(bookings.id, booking.id)).returning({ token: bookings.rescheduleToken });
    ctx.setSubject("booking", booking.id);
    return { bookingId: booking.id, invoiceId, manageToken: guest ? saved?.token ?? null : null };
  },
});

export const myBookingSelection = defineService({
  name:"catalog.myBookingSelection",summary:"The service selection for your own upcoming appointment.",kind:"query",permission:"authenticated",input:z.object({id:z.uuid()}),output:z.object({productId:z.uuid(),offeringId:z.uuid(),calendarId:z.uuid(),seats:z.number().int()}),
  handler:async(input,ctx)=>{
    const contact=await contactForActor(ctx);
    const [row]=await ctx.tx.select({booking:bookings,productId:serviceOfferings.productId}).from(bookings).innerJoin(serviceOfferings,eq(serviceOfferings.id,bookings.serviceOfferingId)).where(and(eq(bookings.id,input.id),eq(bookings.contactId,contact.id))).limit(1);
    if(!row||!["requested","confirmed"].includes(row.booking.status))throw new ServiceError("not_found","That appointment cannot be moved.");
    return{productId:row.productId,offeringId:row.booking.serviceOfferingId!,calendarId:row.booking.calendarId,seats:row.booking.capacityUsed};
  },
});
export const moveMyBooking = defineService({
  name:"catalog.moveMyBooking",summary:"Move your own appointment to a fresh available slot, keeping the original terms and invoice.",kind:"mutation",permission:"authenticated",writeClass:"blocks",input:z.object({id:z.uuid(),startsAt:z.iso.datetime(),calendarId:z.uuid()}),output:z.object({id:z.uuid()}),
  handler:async(input,ctx)=>{
    const selection=await ctx.call(myBookingSelection,{id:input.id});
    const [old]=await ctx.tx.select().from(bookings).where(eq(bookings.id,input.id)).limit(1);
    const business=await ctx.call(getBusiness,{});
    const date=new Intl.DateTimeFormat("en-CA",{timeZone:business?.timezone??"UTC",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(input.startsAt));
    const find=async()=>(await ctx.call(availableSlots,{productId:selection.productId,serviceOfferingId:selection.offeringId,from:date,to:date,seats:selection.seats,preferredCalendarId:input.calendarId,onlyPreferred:true,excludeBookingId:input.id,limit:500})).find(s=>s.calendarId===input.calendarId&&s.startsAt.toISOString()===input.startsAt);
    const candidate=await find();
    if(!candidate)throw new ServiceError("conflict","That time is no longer available.");
    const ids=[...new Set([old!.calendarId,...old!.secondaryCalendarIds,candidate.calendarId,...candidate.resourceCalendarIds])].sort();
    await ctx.tx.select({id:calendars.id}).from(calendars).where(inArray(calendars.id,ids)).orderBy(calendars.id).for("update");
    const slot=await find();
    if(!slot)throw new ServiceError("conflict","That time was just taken.");
    const moved=await ctx.callAsSystem(rescheduleBooking,{id:input.id,startsAt:slot.startsAt.toISOString(),endsAt:slot.endsAt.toISOString(),calendarId:slot.calendarId,secondaryCalendarIds:slot.resourceCalendarIds,overridePolicy:false,reason:"Moved by the customer."});
    ctx.setSubject("booking",moved.id);
    return{id:moved.id};
  },
});
export default [bookableServices, publicBookingQuote, bookPublicService, myBookingSelection, moveMyBooking];
