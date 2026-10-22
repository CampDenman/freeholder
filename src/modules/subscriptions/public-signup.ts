// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.38: verified signup, a canonical first invoice, and payment-bound access.
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { paymentAdapter } from "@/adapters/payments";
import { contactForActor } from "@/core/portal/service";
import { env } from "@/core/env";
import { actorString, defineOrchestratedService, defineService, ServiceError, type ServiceContext } from "@/core/service";
import { getBusiness } from "@/core/settings/service";
import { products, productVariants } from "@/modules/catalog/schema";
import { resolvePrice } from "@/modules/catalog/pricing";
import { sellerCanSell } from "@/modules/catalog/market";
import { registerCheckoutRequirement, registerCheckoutEligibility } from "@/modules/invoicing/checkout-requirements";
import { invoices, paymentMethods, paymentProviderCustomers, payments } from "@/modules/invoicing/schema";
import { plans, subscriptionEvents, subscriptions } from "./schema";

registerCheckoutRequirement("subscription", async (ctx, id) => {
  const [row] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, id.split(":")[0]!)).limit(1);
  return !!row?.signupPending && row.billingMode !== "manual" && !row.paymentMethodId;
});
registerCheckoutEligibility("subscription", async (ctx, id) => {
  const [row] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, id.split(":")[0]!)).limit(1);
  return !!row && !(row.signupPending && !!row.cancelledAt);
});
const planView = z.object({ id: z.uuid(), name: z.string(), description: z.string().nullable(), currency: z.string(), amountMinor: z.number().int(), setupFeeMinor: z.number().int(), interval: z.enum(["day","week","month","year"]), intervalCount:z.number().int(), trialDays:z.number().int(), trialRequiresCard:z.boolean(), billingMode:z.enum(["manual","platform","provider"]), cancelBehaviour:z.enum(["immediate","period_end"]), termsHash:z.string(), available:z.boolean() });

function needsCardTrial(plan: { trialDays: number; trialRequiresCard: boolean }) {
  return plan.trialDays > 0 && plan.trialRequiresCard;
}

/** A card trial is offered only when this instance can actually save the card. */
function membershipAvailable(plan: { billingMode: "manual" | "platform" | "provider"; trialDays: number; trialRequiresCard: boolean; setupFeeMinor: number }, sellerReady: boolean) {
  if (!sellerReady) return false;
  if (plan.billingMode === "manual") return !needsCardTrial(plan);
  const adapter = paymentAdapter();
  const caps = adapter.capabilities();
  const billable = adapter.status.available && caps.savedMethods && (plan.billingMode === "provider" ? caps.subscriptions : caps.offSessionCharges);
  if (!billable) return false;
  if (needsCardTrial(plan) && plan.setupFeeMinor <= 0 && typeof adapter.createMethodSetup !== "function") return false;
  return true;
}
export const publicMembershipPlans = defineService({
  name:"subscriptions.publicPlans", summary:"Public membership prices, trial and cancellation promises — the site's own, or one member's (C12.05).",kind:"query",permission:"public",input:z.object({sellerUserId:z.uuid().optional()}),output:z.array(planView),
  handler:async (input,ctx)=>{
    const business=await ctx.call(getBusiness,{});
    const contact = ctx.actor.kind === "user" ? await contactForActor(ctx).catch((error: unknown) => {
      if (error instanceof ServiceError && ["permission", "not_found"].includes(error.code)) return null;
      throw error;
    }) : null;
    const currency=business?.baseCurrency??"USD";
    const rows=await ctx.tx.select({plan:plans,product:products,variant:productVariants.id}).from(plans).innerJoin(products,eq(products.id,plans.productId)).innerJoin(productVariants,and(eq(productVariants.productId,products.id),eq(productVariants.isDefault,true),eq(productVariants.status,"active"))).where(and(eq(plans.status,"active"),eq(products.status,"active"),eq(products.visibility,"public"),input.sellerUserId?eq(products.sellerUserId,input.sellerUserId):isNull(products.sellerUserId))).orderBy(plans.name);
    // A member's plan is on sale only while that member can be paid (§44.8).
    const sellerReady = input.sellerUserId ? await sellerCanSell(ctx, input.sellerUserId) : true;
    const result=[];
    for(const {plan,product,variant} of rows){
      const price=await ctx.callAsSystem(resolvePrice,{variantId:variant,currency,contactId:contact?.id,quantity:1});
      if(!price.available||price.amountMinor===undefined)continue;
      const promise={id:plan.id,name:plan.name,description:product.subtitle,currency,amountMinor:price.amountMinor,setupFeeMinor:plan.setupFeeMinor,interval:plan.interval,intervalCount:plan.intervalCount,trialDays:plan.trialDays,trialRequiresCard:plan.trialRequiresCard,billingMode:plan.billingMode,cancelBehaviour:plan.cancelBehaviour};
      result.push({...promise,termsHash:createHash("sha256").update(JSON.stringify({...promise,variant,updatedAt:plan.updatedAt})).digest("hex"),available:membershipAvailable(plan, sellerReady)});
    }
    return result;
  },
});
export const myMembership = defineService({
  name:"subscriptions.mine",summary:"Your membership and first-payment status.",kind:"query",permission:"authenticated",input:z.object({id:z.uuid()}),output:z.object({name:z.string(),pending:z.boolean(),invoiceId:z.uuid().nullable(),cancelAtPeriodEnd:z.boolean(),cardSetup:z.boolean()}),
  handler:async(input,ctx)=>{
    const contact=await contactForActor(ctx);
    const [row]=await ctx.tx.select({name:plans.name,pending:subscriptions.signupPending,invoiceId:subscriptions.signupInvoiceId,cancelAtPeriodEnd:subscriptions.cancelAtPeriodEnd,status:subscriptions.status,cancelledAt:subscriptions.cancelledAt,paymentMethodId:subscriptions.paymentMethodId,trialDays:plans.trialDays,trialRequiresCard:plans.trialRequiresCard}).from(subscriptions).innerJoin(plans,eq(plans.id,subscriptions.planId)).where(and(eq(subscriptions.id,input.id),eq(subscriptions.contactId,contact.id))).limit(1);
    if(!row)throw new ServiceError("not_found","That membership is unavailable.");
    return {name:row.name,pending:row.pending,invoiceId:row.invoiceId,cancelAtPeriodEnd:row.cancelAtPeriodEnd,cardSetup:row.pending&&row.invoiceId===null&&row.status==="paused"&&row.cancelledAt===null&&row.paymentMethodId===null&&needsCardTrial(row)};
  },
});
export const myMembershipPaymentMethods = defineService({
  name:"subscriptions.myPaymentMethods",summary:"Your consented, active methods that can bill a membership.",kind:"query",permission:"authenticated",input:z.object({}),output:z.array(z.object({id:z.uuid(),label:z.string()})),
  handler:async(_input,ctx)=>{const contact=await contactForActor(ctx);return ctx.tx.select({id:paymentMethods.id,label:paymentMethods.label}).from(paymentMethods).where(and(eq(paymentMethods.contactId,contact.id),eq(paymentMethods.status,"active"),eq(paymentMethods.provider,paymentAdapter().id),eq(paymentMethods.consentSource,"provider_checkout")));},
});
export const joinMembership = defineService({
  name:"subscriptions.join",summary:"Join a public plan as yourself; paid access waits for the first invoice to settle.",kind:"mutation",permission:"authenticated",writeClass:"money",
  rateLimit: { limit: 10, windowSeconds: 60, subject: (_input, actor) => actorString(actor), message: "Please wait before trying another membership signup." },
  input:z.object({planId:z.uuid(),termsHash:z.string().regex(/^[a-f0-9]{64}$/),requestKey:z.uuid(),acceptedTerms:z.literal(true),paymentMethodId:z.uuid().optional()}),output:z.object({id:z.uuid(),invoiceId:z.uuid().nullable(),pending:z.boolean(),cardSetup:z.boolean()}),
  handler:async(input,ctx)=>{
    const contact=await contactForActor(ctx);
    if(!contact.email)throw new ServiceError("conflict","Verify your email before joining.");
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`membership-signup:${contact.id}:${input.planId}`}))`);
    const [prior]=await ctx.tx.select().from(subscriptions).where(and(eq(subscriptions.contactId,contact.id),eq(subscriptions.publicRequestKey,input.requestKey))).limit(1);
    if(prior){if(prior.planId!==input.planId||prior.publicTermsHash!==input.termsHash)throw new ServiceError("conflict","That request was already used for another signup.");return{id:prior.id,invoiceId:prior.signupInvoiceId,pending:prior.signupPending,cardSetup:prior.signupPending&&prior.signupInvoiceId===null&&prior.cancelledAt===null&&prior.status==="paused"};}
    const [seller]=await ctx.tx.select({sellerUserId:products.sellerUserId}).from(plans).innerJoin(products,eq(products.id,plans.productId)).where(eq(plans.id,input.planId)).limit(1);
    const plan=(await ctx.call(publicMembershipPlans,{sellerUserId:seller?.sellerUserId??undefined})).find(p=>p.id===input.planId);
    if(!plan?.available)throw new ServiceError("conflict","This plan is not available for signup.");
    if(plan.termsHash!==input.termsHash)throw new ServiceError("conflict","This plan changed. Review its price and terms again.");
    const [existing]=await ctx.tx.select({id:subscriptions.id}).from(subscriptions).where(and(eq(subscriptions.contactId,contact.id),eq(subscriptions.planId,input.planId),inArray(subscriptions.status,["active","trialing","past_due","paused"]))).limit(1);
    if(existing)throw new ServiceError("conflict","You already have this membership. Manage it in your portal.");
    const { subscribe } = await import("./service");
    // A chosen card must be the customer's own, consented, for this provider:
    // a staff-entered card never starts customer billing. A card trial with a
    // setup fee opens only from that fee's payment, so a saved card cannot
    // skip the fee invoice (C11.10).
    if(input.paymentMethodId){
      const [method]=await ctx.tx.select().from(paymentMethods).where(eq(paymentMethods.id,input.paymentMethodId)).limit(1);
      if(!method||method.contactId!==contact.id||method.status!=="active"||method.provider!==paymentAdapter().id||method.consentSource!=="provider_checkout")throw new ServiceError("conflict","That saved card cannot be used for this membership.");
    }
    const paymentMethodId=needsCardTrial(plan)&&plan.setupFeeMinor>0?undefined:input.paymentMethodId;
    const created=await ctx.callAsSystem(subscribe,{contactId:contact.id,planId:plan.id,currency:plan.currency,paymentMethodId,deferFirstPayment:true});
    await ctx.tx.update(subscriptions).set({publicRequestKey:input.requestKey,publicTermsHash:input.termsHash}).where(eq(subscriptions.id,created.subscription.id));
    ctx.setSubject("subscription",created.subscription.id);
    return{id:created.subscription.id,invoiceId:created.invoiceId,pending:created.subscription.signupPending,cardSetup:created.subscription.signupPending&&created.invoiceId===null};
  },
});
export const activatePaidSignup = defineService({
  name:"subscriptions.activatePaidSignup",summary:"Activate a pending signup only from its fully settled first invoice.",kind:"mutation",permission:"system",input:z.object({invoiceId:z.uuid()}),output:z.object({activated:z.boolean()}),
  handler:async(input,ctx)=>{
    const [sub]=await ctx.tx.select().from(subscriptions).where(and(eq(subscriptions.signupInvoiceId,input.invoiceId),eq(subscriptions.signupPending,true))).limit(1).for("update");
    if(!sub||sub.status!=="paused"||sub.cancelledAt)return{activated:false};
    const [invoice]=await ctx.tx.select().from(invoices).where(eq(invoices.id,input.invoiceId)).limit(1);
    if(!invoice||invoice.contactId!==sub.contactId||invoice.status!=="paid"||invoice.paidMinor<invoice.totalMinor)return{activated:false};
    let methodId=sub.paymentMethodId;
    let provider=sub.provider;
    if(sub.billingMode!=="manual"&&!methodId){
      const paid=await ctx.tx.select().from(payments).where(and(eq(payments.invoiceId,invoice.id),eq(payments.status,"succeeded"))).orderBy(desc(payments.processedAt));
      const payment=paid.find(p=>(p.metadata as {saveMethodRequested?:boolean})?.saveMethodRequested===true);
      const savedId = (payment?.metadata as {savedPaymentMethodId?:string})?.savedPaymentMethodId;
      if(!payment || !savedId)return{activated:false};
      const [method]=await ctx.tx.select().from(paymentMethods).where(and(eq(paymentMethods.id,savedId),eq(paymentMethods.contactId,sub.contactId),eq(paymentMethods.provider,payment.provider),eq(paymentMethods.status,"active"))).orderBy(desc(paymentMethods.createdAt)).limit(1);
      if(!method)return{activated:false};
      methodId=method.id;provider=method.provider;
    }
    const [plan]=await ctx.tx.select().from(plans).where(eq(plans.id,sub.planId));
    if(!plan)throw new ServiceError("not_found","Membership plan is unavailable.");
    if(needsCardTrial(plan)){
      if(!methodId||!provider)return{activated:false};
      await openCardTrial(ctx,sub,plan,{id:methodId,provider});
      return{activated:true};
    }
    const { periodEnd, keepAccess, record } = await import("./service");
    const start = new Date();
    const end = periodEnd(start, plan.interval, plan.intervalCount);
    await ctx.tx.update(subscriptions).set({status:"active",signupPending:false,pausedAt:null,paymentMethodId:methodId,provider,currentPeriodStart:start,currentPeriodEnd:end}).where(eq(subscriptions.id,sub.id));
    await keepAccess(ctx,{...sub,currentPeriodStart:start},plan.name,end);
    await record(ctx,sub.id,"activated",{invoiceId:invoice.id});
    ctx.setSubject("subscription",sub.id);
    return{activated:true};
  },
});

async function openCardTrial(ctx: ServiceContext, sub: typeof subscriptions.$inferSelect, plan: { name: string; trialDays: number }, method: { id: string; provider: string }) {
  const { periodEnd, keepAccess, record } = await import("./service");
  const start = new Date();
  const end = periodEnd(start, "day", plan.trialDays);
  await ctx.tx.update(subscriptions).set({
    status: "trialing",
    signupPending: false,
    pausedAt: null,
    paymentMethodId: method.id,
    provider: method.provider,
    currentPeriodStart: start,
    currentPeriodEnd: end,
    trialEndsAt: end,
  }).where(eq(subscriptions.id, sub.id));
  await keepAccess(ctx, { ...sub, currentPeriodStart: start }, plan.name, end);
  await record(ctx, sub.id, "trialing", { invoiceId: sub.signupInvoiceId });
  ctx.setSubject("subscription", sub.id);
}

function providerCheckoutUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new ServiceError("conflict", "The payment provider returned an unsafe checkout address."); }
  if (url.protocol !== "https:" || url.username || url.password) throw new ServiceError("conflict", "The payment provider returned an unsafe checkout address.");
  return url.href;
}

function instanceUrl(path: string): string {
  const instance = new URL(env().APP_URL);
  const url = new URL(path, instance);
  if (url.origin !== instance.origin) throw new ServiceError("validation", "Checkout return addresses must stay on this Freeholder instance.");
  return url.href;
}

const claimTrialCardSetup = defineService({
  name: "subscriptions.claimTrialCardSetup",
  summary: "Reserve a paused zero-fee card trial before the provider saves a card.",
  kind: "mutation",
  permission: "authenticated",
  external: false,
  writeClass: "money",
  input: z.object({ subscriptionId: z.uuid(), saveMethodConsent: z.literal(true) }),
  output: z.object({ subscriptionId: z.uuid(), contactId: z.uuid(), email: z.string(), name: z.string(), provider: z.string(), providerCustomerRef: z.string().nullable(), idempotencyKey: z.string() }),
  handler: async (input, ctx) => {
    const contact = await contactForActor(ctx);
    if (!contact.email) throw new ServiceError("conflict", "Verify your email before saving a card.");
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`trial-card:${input.subscriptionId}`}))`);
    const [sub] = await ctx.tx.select().from(subscriptions).where(and(eq(subscriptions.id, input.subscriptionId), eq(subscriptions.contactId, contact.id))).limit(1).for("update");
    if (!sub || sub.cancelledAt || sub.status !== "paused" || !sub.signupPending || sub.paymentMethodId || sub.signupInvoiceId) throw new ServiceError("conflict", "This trial is not waiting for a card.");
    const [plan] = await ctx.tx.select().from(plans).where(eq(plans.id, sub.planId)).limit(1);
    if (!plan || !needsCardTrial(plan) || plan.setupFeeMinor > 0 || plan.billingMode === "manual") throw new ServiceError("conflict", "This trial is not waiting for a card.");
    const adapter = paymentAdapter();
    const caps = adapter.capabilities();
    const billable = adapter.status.available && caps.savedMethods && typeof adapter.createMethodSetup === "function" && (plan.billingMode === "provider" ? caps.subscriptions : caps.offSessionCharges);
    if (!billable) throw new ServiceError("conflict", "Saving a card is not available for this membership.");
    const [known] = await ctx.tx.select({ providerCustomerRef: paymentProviderCustomers.providerCustomerRef }).from(paymentProviderCustomers).where(and(eq(paymentProviderCustomers.contactId, contact.id), eq(paymentProviderCustomers.provider, adapter.id))).orderBy(desc(paymentProviderCustomers.createdAt)).limit(1);
    return { subscriptionId: sub.id, contactId: contact.id, email: contact.email, name: contact.name, provider: adapter.id, providerCustomerRef: known?.providerCustomerRef ?? null, idempotencyKey: `trial-card:${sub.id}` };
  },
});

const applyTrialCardSetup = defineService({
  name: "subscriptions.applyTrialCardSetup",
  summary: "Remember which provider customer a card-setup session belongs to.",
  kind: "mutation",
  permission: "authenticated",
  external: false,
  writeClass: "money",
  input: z.object({ subscriptionId: z.uuid(), provider: z.string().trim().min(1).max(100), providerCustomerRef: z.string().trim().min(1).max(500), url: z.string().url() }),
  output: z.object({ url: z.string().url() }),
  handler: async (input, ctx) => {
    const contact = await contactForActor(ctx);
    const [sub] = await ctx.tx.select().from(subscriptions).where(and(eq(subscriptions.id, input.subscriptionId), eq(subscriptions.contactId, contact.id))).limit(1).for("update");
    if (!sub || sub.cancelledAt || sub.status !== "paused" || !sub.signupPending) throw new ServiceError("conflict", "This trial is not waiting for a card.");
    const url = providerCheckoutUrl(input.url);
    const [created] = await ctx.tx.insert(paymentProviderCustomers).values({ contactId: contact.id, provider: input.provider, providerCustomerRef: input.providerCustomerRef }).onConflictDoNothing().returning({ id: paymentProviderCustomers.id });
    if (!created) {
      const [existing] = await ctx.tx.select().from(paymentProviderCustomers).where(and(eq(paymentProviderCustomers.provider, input.provider), eq(paymentProviderCustomers.providerCustomerRef, input.providerCustomerRef))).limit(1);
      if (!existing || existing.contactId !== contact.id) throw new ServiceError("conflict", "The payment provider customer is already linked to a different contact.");
    }
    const { record } = await import("./service");
    const [previous] = await ctx.tx.select().from(subscriptionEvents).where(and(eq(subscriptionEvents.subscriptionId, sub.id), eq(subscriptionEvents.kind, "card_setup"))).orderBy(desc(subscriptionEvents.at)).limit(1);
    if (previous?.detail && previous.detail !== input.providerCustomerRef) throw new ServiceError("conflict", "This trial is already saving a card with a different provider customer.");
    if (!previous) await record(ctx, sub.id, "card_setup", { detail: input.providerCustomerRef });
    ctx.setSubject("subscription", sub.id);
    return { url };
  },
});

export const beginTrialCardSetup = defineOrchestratedService({
  name: "subscriptions.beginTrialCardSetup",
  summary: "Open a provider page that saves a card for a zero-fee trial without charging it.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "money",
  rateLimit: { limit: 10, windowSeconds: 60, subject: (input: { subscriptionId: string }) => `trial-card:${input.subscriptionId}`, message: "Please wait before saving a card again." },
  input: z.object({ subscriptionId: z.uuid(), saveMethodConsent: z.literal(true) }),
  output: z.object({ url: z.string().url() }),
  handler: async (input, actor) => {
    const claimed = await claimTrialCardSetup.call(input, actor);
    const adapter = paymentAdapter(claimed.provider);
    if (typeof adapter.createMethodSetup !== "function") throw new ServiceError("conflict", "Saving a card is not available for this membership.");
    let created;
    try {
      created = await adapter.createMethodSetup({
        contactId: claimed.contactId,
        subscriptionId: claimed.subscriptionId,
        customer: { email: claimed.email, name: claimed.name },
        providerCustomerRef: claimed.providerCustomerRef ?? undefined,
        successUrl: instanceUrl(`/memberships/trial-return?subscription=${claimed.subscriptionId}`),
        cancelUrl: instanceUrl("/memberships?setup=cancelled"),
        idempotencyKey: claimed.idempotencyKey,
      });
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError("conflict", "The card setup could not be opened. Please try again.");
    }
    if (!created.providerCustomerRef) throw new ServiceError("conflict", "The payment provider did not return a customer reference for this card.");
    return applyTrialCardSetup.call({ subscriptionId: claimed.subscriptionId, provider: claimed.provider, providerCustomerRef: created.providerCustomerRef, url: created.url }, actor);
  },
});

export const startCardTrial = defineService({
  name: "subscriptions.startCardTrial",
  summary: "Start a paused card trial once the customer confirms the saved card.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "money",
  rateLimit: { limit: 10, windowSeconds: 60, subject: (input: { subscriptionId: string }) => `trial-start:${input.subscriptionId}`, message: "Please wait before starting this trial again." },
  input: z.object({ subscriptionId: z.uuid(), paymentMethodId: z.uuid() }),
  output: z.object({ id: z.uuid(), started: z.boolean() }),
  handler: async (input, ctx) => {
    const contact = await contactForActor(ctx);
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`trial-card:${input.subscriptionId}`}))`);
    const [sub] = await ctx.tx.select().from(subscriptions).where(and(eq(subscriptions.id, input.subscriptionId), eq(subscriptions.contactId, contact.id))).limit(1).for("update");
    if (!sub) throw new ServiceError("not_found", "That membership is unavailable.");
    if (sub.status === "trialing" && sub.paymentMethodId === input.paymentMethodId && !sub.signupPending && !sub.cancelledAt) return { id: sub.id, started: true };
    if (sub.cancelledAt || sub.status !== "paused" || !sub.signupPending) throw new ServiceError("conflict", "This membership was cancelled or is no longer waiting for a card.");
    const [plan] = await ctx.tx.select().from(plans).where(eq(plans.id, sub.planId)).limit(1);
    if (!plan || !needsCardTrial(plan)) throw new ServiceError("conflict", "This membership is not a card trial.");
    const [method] = await ctx.tx.select().from(paymentMethods).where(eq(paymentMethods.id, input.paymentMethodId)).limit(1);
    if (!method || method.contactId !== contact.id || method.status !== "active" || method.provider !== paymentAdapter().id || method.consentSource !== "provider_checkout") {
      throw new ServiceError("conflict", "That saved card cannot start this trial.");
    }
    if (plan.setupFeeMinor > 0) {
      if (!sub.signupInvoiceId) throw new ServiceError("conflict", "Pay the setup fee before the trial can start.");
      const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, sub.signupInvoiceId)).limit(1);
      if (!invoice || invoice.status !== "paid" || invoice.paidMinor < invoice.totalMinor) throw new ServiceError("conflict", "Pay the setup fee before the trial can start.");
      const paid = await ctx.tx.select().from(payments).where(and(eq(payments.invoiceId, invoice.id), eq(payments.status, "succeeded"))).orderBy(desc(payments.processedAt));
      const payment = paid.find((entry) => (entry.metadata as { saveMethodRequested?: boolean })?.saveMethodRequested === true);
      const savedId = (payment?.metadata as { savedPaymentMethodId?: string })?.savedPaymentMethodId;
      if (savedId !== method.id) throw new ServiceError("conflict", "That card was not saved for this trial.");
    } else {
      const [setup] = await ctx.tx.select().from(subscriptionEvents).where(and(eq(subscriptionEvents.subscriptionId, sub.id), eq(subscriptionEvents.kind, "card_setup"))).orderBy(desc(subscriptionEvents.at)).limit(1);
      if (!setup?.detail || method.providerCustomerRef !== setup.detail || method.createdAt < setup.at) throw new ServiceError("conflict", "That card was not saved for this trial.");
    }
    await openCardTrial(ctx, sub, plan, method);
    return { id: sub.id, started: true };
  },
});
export const finishMembershipSignups = defineService({
  name:"subscriptions.finishSignups",summary:"Recover settled signup activation and attach future provider renewals.",kind:"mutation",permission:"system",input:z.object({}),output:z.object({finished:z.number().int()}),
  handler:async(_input,ctx)=>{
    const pending=await ctx.tx.select({invoiceId:subscriptions.signupInvoiceId}).from(subscriptions).innerJoin(invoices,eq(invoices.id,subscriptions.signupInvoiceId)).where(and(eq(subscriptions.signupPending,true),eq(invoices.status,"paid"),eq(subscriptions.status,"paused"),isNull(subscriptions.cancelledAt))).limit(100);
    let finished=0;
    for(const row of pending)if(row.invoiceId&&(await ctx.call(activatePaidSignup,{invoiceId:row.invoiceId})).activated)finished++;
    return{finished};
  },
});
export const pendingMembershipSchedules = defineService({
  name:"subscriptions.pendingCustomerSchedules", summary:"Public memberships awaiting their provider renewal schedule.",kind:"query",permission:"system",input:z.object({}),output:z.array(z.uuid()),
  handler:async(_input,ctx)=>(await ctx.tx.select({id:subscriptions.id}).from(subscriptions).where(and(eq(subscriptions.billingMode,"provider"),eq(subscriptions.signupPending,false),inArray(subscriptions.status,["active","trialing"]),isNotNull(subscriptions.publicRequestKey),isNotNull(subscriptions.paymentMethodId),isNull(subscriptions.providerRef),isNull(subscriptions.cancelledAt))).limit(100)).map(s=>s.id),
});
export default [pendingMembershipSchedules,publicMembershipPlans,myMembership,myMembershipPaymentMethods,joinMembership,activatePaidSignup,finishMembershipSignups,beginTrialCardSetup,startCardTrial];
