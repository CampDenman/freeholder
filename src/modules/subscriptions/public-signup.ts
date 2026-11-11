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
import { plans, subscriptionEvents, subscriptionCardSetups, subscriptions } from "./schema";
import { resolveSubscriptionPlanMarketPolicy, subscriptionPaymentScope } from "./market-policy";
import { assertProviderAccount, paymentRouting } from "@/modules/invoicing/merchant-charge";
import {claimSetup,originalSetupRequest,setupRequest} from "./card-setup";

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
function membershipAvailable(plan: { billingMode: "manual" | "platform" | "provider"; trialDays: number; trialRequiresCard: boolean; setupFeeMinor: number }, sellerReady: boolean, direct = false) {
  if (!sellerReady) return false;
  const adapter = direct ? paymentAdapter("stripe") : paymentAdapter();
  if (direct && (!adapter.status.available || !adapter.capabilities().sellerMerchantCharges)) return false;
  if (plan.billingMode === "manual") return !needsCardTrial(plan);
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
      let policyUnavailable = false;
      const policy = await resolveSubscriptionPlanMarketPolicy(ctx, plan.id).catch((error: unknown) => {
        if (error instanceof ServiceError && error.code === "conflict") { policyUnavailable = true; return null; }
        throw error;
      });
      const collectionProvider = plan.billingMode === "manual" ? null : policy?.model === "seller_merchant" ? "stripe" : paymentAdapter().id;
      result.push({...promise,termsHash:createHash("sha256").update(JSON.stringify({...promise,variant,updatedAt:plan.updatedAt,policy,collectionProvider})).digest("hex"),available:!policyUnavailable && membershipAvailable(plan, sellerReady, policy?.model === "seller_merchant")});
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
  name:"subscriptions.myPaymentMethods",summary:"Your consented, active methods for the chosen membership's merchant.",kind:"query",permission:"authenticated",input:z.object({ subscriptionId: z.uuid().optional(), planId: z.uuid().optional() }).refine(value => !value.subscriptionId || !value.planId, "Choose a plan or an existing agreement."),output:z.array(z.object({id:z.uuid(),label:z.string()})),
  handler:async(input,ctx)=>{
    const contact=await contactForActor(ctx);
    let providerAccountId: string | undefined;
    let agreementProvider: string | null = null;
    let setupMethodId:string|undefined;
    if (input.subscriptionId) {
      const [own] = await ctx.tx.select().from(subscriptions).where(and(eq(subscriptions.id,input.subscriptionId),eq(subscriptions.contactId,contact.id))).limit(1);
      if (!own) throw new ServiceError("not_found", "That membership is unavailable.");
      providerAccountId = (await subscriptionPaymentScope(ctx, own.id)).providerAccountId;
      agreementProvider = own.provider;
      if (own.signupPending && own.status === "paused" && !own.signupInvoiceId && !own.paymentMethodId && !own.cancelledAt) {
        const [setup]=await ctx.tx.select().from(subscriptionCardSetups).where(eq(subscriptionCardSetups.subscriptionId,own.id)).orderBy(desc(subscriptionCardSetups.createdAt),desc(subscriptionCardSetups.id)).limit(1);
        if(!setup?.confirmedMethodId)return [];
        setupMethodId=setup.confirmedMethodId;
      }
    } else if (input.planId) providerAccountId = (await resolveSubscriptionPlanMarketPolicy(ctx,input.planId))?.providerAccountId ?? undefined;
    const provider = providerAccountId ? "stripe" : agreementProvider ?? paymentAdapter().id;
    return ctx.tx.select({id:paymentMethods.id,label:paymentMethods.label}).from(paymentMethods).where(and(eq(paymentMethods.contactId,contact.id),eq(paymentMethods.status,"active"),eq(paymentMethods.provider,provider),eq(paymentMethods.providerAccountId,providerAccountId ?? ""),eq(paymentMethods.consentSource,"provider_checkout"),setupMethodId?eq(paymentMethods.id,setupMethodId):undefined));
  },
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
      const policy=await resolveSubscriptionPlanMarketPolicy(ctx,plan.id);
      const provider=policy?.model==="seller_merchant"?"stripe":paymentAdapter().id;
      if(!method||method.contactId!==contact.id||method.status!=="active"||method.provider!==provider||method.providerAccountId!==(policy?.providerAccountId??"")||method.consentSource!=="provider_checkout")throw new ServiceError("conflict","That saved card cannot be used for this membership.");
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
  const routing = await subscriptionPaymentScope(ctx, sub.id, true);
  const [stored] = await ctx.tx.select().from(paymentMethods).where(eq(paymentMethods.id, method.id)).limit(1);
  if (!stored || stored.contactId !== sub.contactId || stored.provider !== method.provider || stored.providerAccountId !== (routing.providerAccountId ?? "") || (routing.providerAccountId && stored.provider !== "stripe")) throw new ServiceError("conflict", "The saved card belongs to a different membership merchant.");
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
  output: z.object({attemptId:z.uuid(),provider:z.string(),request:setupRequest,customerRef:z.string().nullable(),createdAt:z.iso.datetime(),providerRef:z.string().nullable(),recover:z.boolean(),url:z.url().nullable()}),
  handler: async (input, ctx) => {
    const contact = await contactForActor(ctx);
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`trial-card:${input.subscriptionId}`}))`);
    const [sub] = await ctx.tx.select().from(subscriptions).where(and(eq(subscriptions.id, input.subscriptionId), eq(subscriptions.contactId, contact.id))).limit(1).for("update");
    if (!sub || sub.cancelledAt || sub.status !== "paused" || !sub.signupPending || sub.paymentMethodId || sub.signupInvoiceId) throw new ServiceError("conflict", "This trial is not waiting for a card.");
    const [plan] = await ctx.tx.select().from(plans).where(eq(plans.id, sub.planId)).limit(1);
    if (!plan || !needsCardTrial(plan) || plan.setupFeeMinor > 0 || plan.billingMode === "manual") throw new ServiceError("conflict", "This trial is not waiting for a card.");
    const routing = await subscriptionPaymentScope(ctx, sub.id, true);
    const adapter = paymentAdapter(routing.providerAccountId ? "stripe" : sub.provider ?? undefined);
    const caps = adapter.capabilities();
    const billable = adapter.status.available && caps.savedMethods && (!routing.providerAccountId || caps.sellerMerchantCharges) && typeof adapter.createMethodSetup === "function" && (plan.billingMode === "provider" ? caps.subscriptions : caps.offSessionCharges);
    if (!billable) throw new ServiceError("conflict", "Saving a card is not available for this membership.");
    const [known] = await ctx.tx.select({ providerCustomerRef: paymentProviderCustomers.providerCustomerRef }).from(paymentProviderCustomers).where(and(eq(paymentProviderCustomers.contactId, contact.id), eq(paymentProviderCustomers.provider, adapter.id),eq(paymentProviderCustomers.providerAccountId,routing.providerAccountId??""))).orderBy(desc(paymentProviderCustomers.createdAt)).limit(1);
    const claimed=await claimSetup(ctx,{subscriptionId:sub.id,contactId:contact.id,provider:adapter.id,providerAccountId:routing.providerAccountId,customer:{email:contact.email,name:contact.name},providerCustomerRef:known?.providerCustomerRef,currency:sub.currency,successUrl:instanceUrl(`/memberships/trial-return?subscription=${sub.id}`),cancelUrl:instanceUrl("/memberships?setup=cancelled")});
    if(!sub.provider)await ctx.tx.update(subscriptions).set({provider:adapter.id}).where(eq(subscriptions.id,sub.id));
    ctx.setSubject("subscription",sub.id);
    return {attemptId:claimed.attempt.id,provider:adapter.id,request:claimed.request,customerRef:claimed.attempt.providerCustomerRef,createdAt:claimed.attempt.createdAt.toISOString(),providerRef:claimed.attempt.providerCheckoutRef,recover:claimed.recover,url:claimed.url};
  },
});

const applyTrialCardSetup = defineService({
  name: "subscriptions.applyTrialCardSetup",
  summary: "Remember which provider customer a card-setup session belongs to.",
  kind: "mutation",
  permission: "authenticated",
  external: false,
  writeClass: "money",
  input: z.object({ stage:z.enum(["customer","session","expired"]).default("session"),attemptId:z.uuid(),providerRef:z.string().min(1).max(500).optional(),expiresAt:z.iso.datetime().optional(),subscriptionId: z.uuid(), provider: z.string().trim().min(1).max(100), providerAccountId: paymentRouting.shape.providerAccountId, providerCustomerRef: z.string().trim().min(1).max(500).optional(), url: z.string().url().optional() }),
  output: z.object({ url: z.string().url().nullable() }),
  handler: async (input, ctx) => {
    const contact = await contactForActor(ctx);
    const [sub] = await ctx.tx.select().from(subscriptions).where(and(eq(subscriptions.id, input.subscriptionId), eq(subscriptions.contactId, contact.id))).limit(1).for("update");
    if (!sub || sub.cancelledAt || sub.status !== "paused" || !sub.signupPending) throw new ServiceError("conflict", "This trial is not waiting for a card.");
    const routing = await subscriptionPaymentScope(ctx, sub.id);
    assertProviderAccount(routing, input);
    if(sub.provider && sub.provider!==input.provider) throw new ServiceError("conflict","This card setup belongs to a different membership provider.");
    if (routing.providerAccountId && input.provider !== "stripe") throw new ServiceError("conflict", "This trial needs its original Stripe merchant account.");
    const [attempt]=await ctx.tx.select().from(subscriptionCardSetups).where(and(eq(subscriptionCardSetups.id,input.attemptId),eq(subscriptionCardSetups.subscriptionId,sub.id))).for("update");
    if(!attempt)throw new ServiceError("conflict","This card setup is no longer available.");
    const original=originalSetupRequest(attempt);
    if(attempt.provider!==input.provider || attempt.providerAccountId!==(input.providerAccountId??""))throw new ServiceError("conflict","The provider response belongs to another setup account.");
    if(input.stage==="expired"){
      if(attempt.confirmedAt)throw new ServiceError("conflict","This setup already confirmed its saved card.");
      if(input.stage==="expired" && (!input.providerRef || (attempt.providerCheckoutRef && attempt.providerCheckoutRef!==input.providerRef) || !input.providerCustomerRef || (attempt.providerCustomerRef && attempt.providerCustomerRef!==input.providerCustomerRef)))throw new ServiceError("conflict","The closed session does not match this setup.");
      await ctx.tx.update(subscriptionCardSetups).set({closedAt:sql`clock_timestamp()`,closedReason:"expired",...(input.stage==="expired"?{providerCheckoutRef:input.providerRef!,providerCustomerRef:input.providerCustomerRef!}:{})}).where(and(eq(subscriptionCardSetups.id,attempt.id),isNull(subscriptionCardSetups.closedAt)));
      ctx.setSubject("subscription",sub.id);
      return {url:null};
    }
    if(attempt.closedAt || !input.providerCustomerRef)throw new ServiceError("conflict","This setup is closed or has no provider customer.");
    if(attempt.provider!==input.provider || attempt.providerAccountId!==(input.providerAccountId??"") || (attempt.providerCustomerRef && attempt.providerCustomerRef!==input.providerCustomerRef) || (input.stage==="session" && attempt.providerCheckoutRef && attempt.providerCheckoutRef!==input.providerRef) || (original.providerCustomerRef && original.providerCustomerRef!==input.providerCustomerRef))throw new ServiceError("conflict","The provider response does not match this original card setup.");
    if(input.stage==="session" && (!input.url || !input.providerRef))throw new ServiceError("conflict","The provider did not return this setup session.");
    const url = input.stage==="session" ? providerCheckoutUrl(input.url!) : null;
    await ctx.tx.update(subscriptionCardSetups).set({providerCustomerRef:input.providerCustomerRef,...(input.stage==="session"?{providerCheckoutRef:input.providerRef!,checkoutUrl:url,expiresAt:input.expiresAt?new Date(input.expiresAt):null}:{})}).where(eq(subscriptionCardSetups.id,attempt.id));
    const [created] = await ctx.tx.insert(paymentProviderCustomers).values({ contactId: contact.id, provider: input.provider, providerAccountId: routing.providerAccountId??"", providerCustomerRef: input.providerCustomerRef }).onConflictDoNothing().returning({ id: paymentProviderCustomers.id });
    if (!created) {
      const [existing] = await ctx.tx.select().from(paymentProviderCustomers).where(and(eq(paymentProviderCustomers.provider, input.provider),eq(paymentProviderCustomers.providerAccountId,routing.providerAccountId??""), eq(paymentProviderCustomers.providerCustomerRef, input.providerCustomerRef))).limit(1);
      if (!existing || existing.contactId !== contact.id) throw new ServiceError("conflict", "The payment provider customer is already linked to a different contact.");
    }
    const { record } = await import("./service");
    const [previous] = await ctx.tx.select().from(subscriptionEvents).where(and(eq(subscriptionEvents.subscriptionId, sub.id), eq(subscriptionEvents.kind, "card_setup"))).orderBy(desc(subscriptionEvents.at)).limit(1);
    if (previous?.detail && previous.detail !== input.providerCustomerRef) throw new ServiceError("conflict", "This trial is already saving a card with a different provider customer.");
    if (!previous) await record(ctx, sub.id, "card_setup", { detail: input.providerCustomerRef });
    if (!sub.provider) await ctx.tx.update(subscriptions).set({provider:input.provider}).where(eq(subscriptions.id,sub.id));
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
    for(let round=0;round<3;round++){
      const claimed = await claimTrialCardSetup.call(input, actor);
      if(claimed.url)return {url:claimed.url};
      const adapter = paymentAdapter(claimed.provider);
      if (!adapter.createMethodSetup) throw new ServiceError("conflict", "Saving a card is not available for this membership.");
      let customerRef=claimed.customerRef;
      try {
        if(claimed.recover){
          if(!adapter.recoverMethodSetup)throw new ServiceError("conflict","Reconcile this original setup with its payment provider before retrying.");
          const recovered=await adapter.recoverMethodSetup({...claimed.request,providerCustomerRef:customerRef??undefined,providerRef:claimed.providerRef??undefined,createdAt:claimed.createdAt});
          if(recovered.state==="unresolved" || recovered.state==="customer_only")throw new ServiceError("conflict","The original setup outcome is unresolved. Confirm its actual provider outcome before retrying.");
          if(recovered.state==="expired"){
            await applyTrialCardSetup.call({stage:recovered.state,attemptId:claimed.attemptId,providerRef:recovered.providerRef,providerAccountId:recovered.providerAccountId,subscriptionId:claimed.request.subscriptionId,provider:claimed.provider,providerCustomerRef:recovered.providerCustomerRef},actor);
            continue;
          }
          if(!recovered.providerCustomerRef)throw new ServiceError("conflict","The provider did not reconcile the setup customer.");
          customerRef=recovered.providerCustomerRef;
          await applyTrialCardSetup.call({stage:"customer",attemptId:claimed.attemptId,providerAccountId:recovered.providerAccountId,subscriptionId:claimed.request.subscriptionId,provider:claimed.provider,providerCustomerRef:customerRef},actor);
          if(recovered.state==="complete"){
            if(!recovered.event || recovered.event.kind!=="saved_method_added" || recovered.event.setup?.attemptId!==claimed.attemptId)throw new ServiceError("conflict","The provider did not prove this original saved-card setup.");
            const {processPaymentProviderEvents}=await import("@/modules/invoicing/payment-provider-service");
            await processPaymentProviderEvents.call({provider:claimed.provider,bodySha256:createHash("sha256").update(JSON.stringify(recovered.event)).digest("hex"),receivedAt:new Date().toISOString(),events:[recovered.event]},{kind:"system"});
            return {url:claimed.request.successUrl};
          }
          if(recovered.state==="open"){
            if(!recovered.providerRef || !recovered.url)throw new ServiceError("conflict","The provider did not return its original session.");
            const applied=await applyTrialCardSetup.call({stage:"session",attemptId:claimed.attemptId,providerRef:recovered.providerRef,expiresAt:recovered.expiresAt,providerAccountId:recovered.providerAccountId,subscriptionId:claimed.request.subscriptionId,provider:claimed.provider,providerCustomerRef:customerRef,url:recovered.url},actor);
            if(!applied.url)throw new ServiceError("conflict","The original setup session is unavailable.");
            return {url:applied.url};
          }
        }
        if(!customerRef){
          if(!adapter.createSetupCustomer)throw new ServiceError("conflict","This provider cannot safely create a setup customer.");
          const customer=await adapter.createSetupCustomer(claimed.request);
          await applyTrialCardSetup.call({stage:"customer",attemptId:claimed.attemptId,providerAccountId:customer.providerAccountId,subscriptionId:claimed.request.subscriptionId,provider:claimed.provider,providerCustomerRef:customer.providerCustomerRef},actor);
          customerRef=customer.providerCustomerRef;
        }
        const created = await adapter.createMethodSetup({...claimed.request,providerCustomerRef:customerRef});
        if (!created.providerCustomerRef) throw new ServiceError("conflict", "The payment provider did not return a customer reference for this card.");
        const applied=await applyTrialCardSetup.call({stage:"session",attemptId:claimed.attemptId,providerRef:created.providerRef,expiresAt:created.expiresAt,providerAccountId:created.providerAccountId,subscriptionId:claimed.request.subscriptionId,provider:claimed.provider,providerCustomerRef:created.providerCustomerRef,url:created.url},actor);
        if(!applied.url)throw new ServiceError("conflict","The setup session is not available.");
        return {url:applied.url};
      } catch (error) {
        if (error instanceof ServiceError) throw error;
        throw new ServiceError("conflict", "The card setup could not be opened. Please try again.");
      }
    }
    throw new ServiceError("conflict","The provider setup changed while recovering. Please retry.");
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
    const routing = await subscriptionPaymentScope(ctx, sub.id, true);
    const provider = routing.providerAccountId ? "stripe" : sub.provider ?? paymentAdapter().id;
    if (!method || method.contactId !== contact.id || method.status !== "active" || method.provider !== provider || method.providerAccountId !== (routing.providerAccountId??"") || method.consentSource !== "provider_checkout") {
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
      const [setup]=await ctx.tx.select().from(subscriptionCardSetups).where(eq(subscriptionCardSetups.subscriptionId,sub.id)).orderBy(desc(subscriptionCardSetups.createdAt),desc(subscriptionCardSetups.id)).limit(1);
      if(!setup?.confirmedAt || setup.confirmedMethodId!==method.id || setup.provider!==method.provider || setup.providerAccountId!==method.providerAccountId || setup.providerCustomerRef!==method.providerCustomerRef)throw new ServiceError("conflict","That card was not verified for this exact trial setup.");
    }
    await openCardTrial(ctx, sub, plan, method);
    return { id: sub.id, started: true };
  },
});
export const finishMembershipSignups = defineService({
  name:"subscriptions.finishSignups",summary:"Recover settled signup activation and attach future provider renewals.",kind:"mutation",permission:"system",input:z.object({}),output:z.object({finished:z.number().int()}),auditWhen:(out:{finished:number})=>out.finished>0,
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
