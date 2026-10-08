// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C6.19: public discovery and verified, retry-safe customer reservations.
import { cancellationTerms, termsFrom } from "@/core/scheduling/policy";
import { createHash } from "node:crypto";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { actorString, defineService, ServiceError } from "@/core/service";
import { contactForActor } from "@/core/portal/service";
import { getBusiness } from "@/core/settings/service";
import { availableSlots } from "@/core/scheduling/resolver-service";
import { createBooking, rescheduleBooking } from "@/core/scheduling/bookings";
import { bookings, calendars } from "@/core/scheduling/schema";
import { createDraftInvoice, issueInvoice } from "@/modules/invoicing/invoice-service";
import { createPaymentPlan } from "@/modules/invoicing/advanced-money-service";
import { serviceOfferings } from "./schema";
import { bookingTerms, getServiceOffering, listPriceRules, quoteServicePayment } from "./offerings";

const selection = z.object({ productId: z.uuid(), currency: z.string().length(3), mode: z.enum(["full", "deposit_balance"]).default("full"), seats: z.number().int().min(1).max(100).default(1) });
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
    const policy = termsFrom(await ctx.call(bookingTerms, { serviceOfferingId: offering.id }));
    const hash = createHash("sha256").update(JSON.stringify({ productId: product.id, offeringId: offering.id, durationMin: offering.durationMin, capacity: offering.capacity, offeringUpdatedAt: offering.updatedAt, price: price.priceMinor, due: price.dueNowMinor, currency: input.currency, mode: input.mode, seats: input.seats, policy })).digest("hex");
    return { productId: product.id, offeringId: offering.id, name: product.name, durationMin: offering.durationMin, capacity: offering.capacity, currency: input.currency, totalMinor: price.priceMinor, dueNowMinor: price.dueNowMinor, balanceMinor: price.priceMinor-price.dueNowMinor, mode: input.mode, termsHash: hash, policy };
  },
});

export const bookableServices = defineService({
  name: "catalog.bookableServices", summary: "Active public services and their offered booking payment modes.", kind: "query", permission: "public", input: z.object({}),
  output: z.object({ currency: z.string(), services: z.array(z.object({ productId: z.uuid(), offeringId: z.uuid(), name: z.string(), durationMin: z.number().int(), modes: z.array(z.enum(["full", "deposit_balance"])) })) }),
  handler: async (_input, ctx) => {
    const business = await ctx.call(getBusiness, {});
    const { listVisibleProducts } = await import("./service");
    const products = (await ctx.call(listVisibleProducts, { limit: 500 })).filter(p=>p.kind==="service");
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

export const bookPublicService = defineService({
  name: "catalog.bookService", summary: "Reserve a currently available service for the signed-in customer and issue its canonical invoice.", kind: "mutation", permission: "authenticated", writeClass: "money",
  input: selection.extend({ calendarId: z.uuid(), startsAt: z.iso.datetime(), termsHash: z.string().regex(/^[a-f0-9]{64}$/), acceptedTerms: z.literal(true), requestKey: z.uuid() }),
  rateLimit: { limit: 10, windowSeconds: 60, subject: (_input, actor) => actorString(actor), message: "Please wait before trying this reservation again." },
  output: z.object({ bookingId: z.uuid(), invoiceId: z.uuid().nullable() }),
  handler: async (input, ctx) => {
    const contact = await contactForActor(ctx);
    if (!contact.email) throw new ServiceError("conflict", "Verify your customer email before booking.");
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`booking-request:${contact.id}:${input.requestKey}`}))`);
    const [prior] = await ctx.tx.select().from(bookings).where(and(eq(bookings.contactId, contact.id), eq(bookings.publicRequestKey, input.requestKey))).limit(1);
    if (prior) {
      const priorProduct = await ctx.call(getServiceOffering, { productId: input.productId });
      if (prior.serviceOfferingId !== priorProduct?.id || prior.calendarId !== input.calendarId || prior.startsAt.getTime() !== new Date(input.startsAt).getTime() || prior.capacityUsed !== input.seats || (prior.meta as {publicTermsHash?:string})?.publicTermsHash !== input.termsHash) throw new ServiceError("conflict", "This request was already used for a different reservation.");
      return { bookingId: prior.id, invoiceId: prior.invoiceId };
    }
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
    await ctx.tx.update(bookings).set({ invoiceId, cancellationPolicy: quote.policy, publicRequestKey: input.requestKey, meta: { publicTermsHash: input.termsHash } }).where(eq(bookings.id, booking.id));
    ctx.setSubject("booking", booking.id);
    return { bookingId: booking.id, invoiceId };
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
