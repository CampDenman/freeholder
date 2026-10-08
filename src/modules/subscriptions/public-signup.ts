// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.38: verified signup, a canonical first invoice, and payment-bound access.
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { paymentAdapter } from "@/adapters/payments";
import { contactForActor } from "@/core/portal/service";
import { actorString, defineService, ServiceError } from "@/core/service";
import { getBusiness } from "@/core/settings/service";
import { products, productVariants } from "@/modules/catalog/schema";
import { resolvePrice } from "@/modules/catalog/pricing";
import { registerCheckoutRequirement, registerCheckoutEligibility } from "@/modules/invoicing/checkout-requirements";
import { invoices, paymentMethods, payments } from "@/modules/invoicing/schema";
import { plans, subscriptions } from "./schema";

registerCheckoutRequirement("subscription", async (ctx, id) => {
  const [row] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, id.split(":")[0]!)).limit(1);
  return !!row?.signupPending && row.billingMode !== "manual" && !row.paymentMethodId;
});
registerCheckoutEligibility("subscription", async (ctx, id) => {
  const [row] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, id.split(":")[0]!)).limit(1);
  return !!row && !(row.signupPending && !!row.cancelledAt);
});
const planView = z.object({ id: z.uuid(), name: z.string(), description: z.string().nullable(), currency: z.string(), amountMinor: z.number().int(), setupFeeMinor: z.number().int(), interval: z.enum(["day","week","month","year"]), intervalCount:z.number().int(), trialDays:z.number().int(), trialRequiresCard:z.boolean(), billingMode:z.enum(["manual","platform","provider"]), cancelBehaviour:z.enum(["immediate","period_end"]), termsHash:z.string(), available:z.boolean() });
export const publicMembershipPlans = defineService({
  name:"subscriptions.publicPlans", summary:"Public membership prices, trial and cancellation promises.",kind:"query",permission:"public",input:z.object({}),output:z.array(planView),
  handler:async (_input,ctx)=>{
    const business=await ctx.call(getBusiness,{});
    const currency=business?.baseCurrency??"USD";
    const rows=await ctx.tx.select({plan:plans,product:products,variant:productVariants.id}).from(plans).innerJoin(products,eq(products.id,plans.productId)).innerJoin(productVariants,and(eq(productVariants.productId,products.id),eq(productVariants.isDefault,true),eq(productVariants.status,"active"))).where(and(eq(plans.status,"active"),eq(products.status,"active"),eq(products.visibility,"public"))).orderBy(plans.name);
    const result=[];
    for(const {plan,product,variant} of rows){
      const price=await ctx.callAsSystem(resolvePrice,{variantId:variant,currency,quantity:1});
      if(!price.available||price.amountMinor===undefined)continue;
      const promise={id:plan.id,name:plan.name,description:product.subtitle,currency,amountMinor:price.amountMinor,setupFeeMinor:plan.setupFeeMinor,interval:plan.interval,intervalCount:plan.intervalCount,trialDays:plan.trialDays,trialRequiresCard:plan.trialRequiresCard,billingMode:plan.billingMode,cancelBehaviour:plan.cancelBehaviour};
      const adapter=paymentAdapter();
      result.push({...promise,termsHash:createHash("sha256").update(JSON.stringify({...promise,variant,updatedAt:plan.updatedAt})).digest("hex"),available:plan.billingMode==="manual" || (adapter.status.available && adapter.capabilities().savedMethods && (plan.billingMode==="provider" ? adapter.capabilities().subscriptions : adapter.capabilities().offSessionCharges))});
    }
    return result;
  },
});
export const myMembership = defineService({
  name:"subscriptions.mine",summary:"Your membership and first-payment status.",kind:"query",permission:"authenticated",input:z.object({id:z.uuid()}),output:z.object({name:z.string(),pending:z.boolean(),invoiceId:z.uuid().nullable(),cancelAtPeriodEnd:z.boolean()}),
  handler:async(input,ctx)=>{
    const contact=await contactForActor(ctx);
    const [row]=await ctx.tx.select({name:plans.name,pending:subscriptions.signupPending,invoiceId:subscriptions.signupInvoiceId,cancelAtPeriodEnd:subscriptions.cancelAtPeriodEnd}).from(subscriptions).innerJoin(plans,eq(plans.id,subscriptions.planId)).where(and(eq(subscriptions.id,input.id),eq(subscriptions.contactId,contact.id))).limit(1);
    if(!row)throw new ServiceError("not_found","That membership is unavailable.");return row;
  },
});
export const myMembershipPaymentMethods = defineService({
  name:"subscriptions.myPaymentMethods",summary:"Your consented, active methods that can bill a membership.",kind:"query",permission:"authenticated",input:z.object({}),output:z.array(z.object({id:z.uuid(),label:z.string()})),
  handler:async(_input,ctx)=>{const contact=await contactForActor(ctx);return ctx.tx.select({id:paymentMethods.id,label:paymentMethods.label}).from(paymentMethods).where(and(eq(paymentMethods.contactId,contact.id),eq(paymentMethods.status,"active"),eq(paymentMethods.provider,paymentAdapter().id)));},
});
export const joinMembership = defineService({
  name:"subscriptions.join",summary:"Join a public plan as yourself; paid access waits for the first invoice to settle.",kind:"mutation",permission:"authenticated",writeClass:"money",
  rateLimit: { limit: 10, windowSeconds: 60, subject: (_input, actor) => actorString(actor), message: "Please wait before trying another membership signup." },
  input:z.object({planId:z.uuid(),termsHash:z.string().regex(/^[a-f0-9]{64}$/),requestKey:z.uuid(),acceptedTerms:z.literal(true),paymentMethodId:z.uuid().optional()}),output:z.object({id:z.uuid(),invoiceId:z.uuid().nullable(),pending:z.boolean()}),
  handler:async(input,ctx)=>{
    const contact=await contactForActor(ctx);
    if(!contact.email)throw new ServiceError("conflict","Verify your email before joining.");
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`membership-signup:${contact.id}:${input.planId}`}))`);
    const [prior]=await ctx.tx.select().from(subscriptions).where(and(eq(subscriptions.contactId,contact.id),eq(subscriptions.publicRequestKey,input.requestKey))).limit(1);
    if(prior){if(prior.planId!==input.planId||prior.publicTermsHash!==input.termsHash)throw new ServiceError("conflict","That request was already used for another signup.");return{id:prior.id,invoiceId:prior.signupInvoiceId,pending:prior.signupPending};}
    const plan=(await ctx.call(publicMembershipPlans,{})).find(p=>p.id===input.planId);
    if(!plan?.available)throw new ServiceError("conflict","This plan is not available for signup.");
    if(plan.termsHash!==input.termsHash)throw new ServiceError("conflict","This plan changed. Review its price and terms again.");
    const [existing]=await ctx.tx.select({id:subscriptions.id}).from(subscriptions).where(and(eq(subscriptions.contactId,contact.id),eq(subscriptions.planId,input.planId),inArray(subscriptions.status,["active","trialing","past_due","paused"]))).limit(1);
    if(existing)throw new ServiceError("conflict","You already have this membership. Manage it in your portal.");
    const { subscribe } = await import("./service");
    const created=await ctx.callAsSystem(subscribe,{contactId:contact.id,planId:plan.id,currency:plan.currency,paymentMethodId:input.paymentMethodId,deferFirstPayment:true});
    await ctx.tx.update(subscriptions).set({publicRequestKey:input.requestKey,publicTermsHash:input.termsHash}).where(eq(subscriptions.id,created.subscription.id));
    ctx.setSubject("subscription",created.subscription.id);
    return{id:created.subscription.id,invoiceId:created.invoiceId,pending:created.subscription.signupPending};
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
export default [pendingMembershipSchedules,publicMembershipPlans,myMembership,myMembershipPaymentMethods,joinMembership,activatePaidSignup,finishMembershipSignups];
