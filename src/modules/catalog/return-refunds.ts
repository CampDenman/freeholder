// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19: immutable original-tender plans, actual provider refunds and human offline attestations.
import {createHash} from "node:crypto";
import {and,eq,inArray,ne,sql} from "drizzle-orm";
import {z} from "zod";
import {paymentAdapter,isHostedPaymentProvider} from "@/adapters/payments";
import {actorString,defineOrchestratedService,defineService,ServiceError,type ServiceContext} from "@/core/service";
import {notifyReturnRefund} from "./return-notifications";
import {createCreditNote,getInvoice,issueCreditNote,reserveRefundBatch,settleRefund} from "@/modules/invoicing/invoice-service";
import {providerPaymentSource,submitProviderRefund} from "@/modules/invoicing/payment-provider-service";
import {refundCustomerBalancePayment} from "@/modules/invoicing/advanced-money-service";
import {QUANTITY_SCALE,sumMinor} from "@/modules/invoicing/money";
import {getReturn} from "./fulfillment";
import {returnDetail} from "./return-contract";
import {orderItems,orders,returnItems,returnRequests,returnRefundAllocations} from "./schema";
const id=z.uuid();
const money=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const operation=z.object({id,idempotencyKey:z.string().trim().min(8).max(240)});
type Invoice=Awaited<ReturnType<typeof getInvoice.call>>;
type Request=typeof returnRequests.$inferSelect;
type Allocation=typeof returnRefundAllocations.$inferSelect;
const reserved=(status:string)=>["created","processing","succeeded"].includes(status);
function assigned(invoice:Invoice,request:Pick<Request,"id">,allocation:Pick<Allocation,"id"|"paymentId">){
 return invoice.refunds.filter(refund=>refund.paymentId===allocation.paymentId && (
  refund.idempotencyKey.startsWith(`return:${request.id}:allocation:${allocation.id}:`)
  || refund.idempotencyKey===`return:${request.id}:refund:${refund.paymentId}`
  || (refund.idempotencyKey.startsWith(`return:${request.id}:provider:`) && refund.idempotencyKey.endsWith(`:${refund.paymentId}`))));
}
function total(rows:Invoice["refunds"],predicate:(row:Invoice["refunds"][number])=>boolean){return sumMinor(rows.filter(predicate).map(row=>row.amountMinor),"Return refund balance");}
/** C5.19: return only the discounted consideration and tax actually invoiced.
 * Cumulative integer allocation leaves the final returned unit every rounding
 * remainder, without recalculating historical tax using today's rules.
 */
async function returnCredit(ctx: ServiceContext, request: typeof returnRequests.$inferSelect, invoice: Awaited<ReturnType<typeof getInvoice.call>>) {
  const items = await ctx.tx.select().from(returnItems).where(eq(returnItems.returnId, request.id));
  const prior = await ctx.tx.select({ orderItemId: returnItems.orderItemId, quantity: returnItems.quantity })
    .from(returnItems).innerJoin(returnRequests, eq(returnRequests.id, returnItems.returnId))
    .where(and(eq(returnRequests.orderId, request.orderId), ne(returnRequests.id, request.id), sql`${returnRequests.creditNoteId} is not null`));
  const creditLines = [];
  for (const item of items) {
    const [ordered] = await ctx.tx.select().from(orderItems).where(and(eq(orderItems.id,item.orderItemId),eq(orderItems.orderId,request.orderId)));
    if (!ordered) throw new ServiceError("conflict", "The original returned order line is missing.");
    const candidates = invoice.lines.filter(line => line.sourceType === "variant" && line.sourceId === ordered.variantId
      && line.quantityMicros === ordered.quantity * QUANTITY_SCALE && line.unitAmountMinor === ordered.unitAmountMinor);
    const original = typeof ordered.snapshot.invoiceLineId === "string"
      ? candidates.find(line=>line.id===ordered.snapshot.invoiceLineId)
      : candidates.length === 1 ? candidates[0] : undefined;
    if (!original) throw new ServiceError("conflict", "Reconcile this return with its original invoice line before refunding it.");
    const previous = prior.filter(line=>line.orderItemId===item.orderItemId).reduce((n,line)=>n+line.quantity,0);
    if (previous + item.quantity > ordered.quantity) throw new ServiceError("conflict", "Credited units exceed the original order line.");
    const share = (amount: number) => Number(BigInt(amount) * BigInt(previous + item.quantity) / BigInt(ordered.quantity)
      - BigInt(amount) * BigInt(previous) / BigInt(ordered.quantity));
    creditLines.push({ invoiceLineId: original.id, description: original.description,
      quantityMicros: item.quantity * QUANTITY_SCALE,
      subtotalMinor: share(original.subtotalMinor - original.discountMinor), taxMinor: share(original.taxMinor) });
  }
  const amountMinor = sumMinor(creditLines.flatMap(line=>[line.subtotalMinor,line.taxMinor]),"Return amount");
  if (!creditLines.length || amountMinor <= 0) throw new ServiceError("validation", "There is nothing to refund on this return.");
  return { creditLines, amountMinor };
}

async function context(ctx:ServiceContext,returnId:string,lock=false){
 const [source]=await ctx.tx.select().from(returnRequests).where(eq(returnRequests.id,returnId));
 if(!source) throw new ServiceError("not_found","That return is not here.");
 const query=ctx.tx.select().from(orders).where(eq(orders.id,source.orderId));
 const [order]=await(lock ? query.for("update") : query);
 const current=ctx.tx.select().from(returnRequests).where(eq(returnRequests.id,returnId));
 const [request]=await(lock ? current.for("update") : current);
 if(!request || !order?.invoiceId) throw new ServiceError("conflict","That return has no original invoice.");
 const invoice=await ctx.callAsSystem(getInvoice,{id:order.invoiceId});
 return {request,order,invoice};
}

async function original(ctx:ServiceContext,invoice:Invoice,paymentId:string){
 const source=await ctx.callAsSystem(providerPaymentSource,{paymentId});
 const payment=source.payment;
 if(payment.invoiceId!==invoice.invoice.id || payment.currency!==invoice.invoice.currency || payment.status!=="succeeded") throw new ServiceError("conflict","Reconcile this return's original payment before refunding it.");
 if(payment.provider!=="manual" && payment.provider!=="balance" && (!isHostedPaymentProvider(payment.provider) || !payment.providerRef || !paymentAdapter(payment.provider).capabilities().refunds)) throw new ServiceError("conflict","This original payment needs provider reconciliation before it can be refunded.");
 return {payment,...source.routing,providerAccountId:source.routing.providerAccountId??"",applicationFeeMinor:source.routing.applicationFeeMinor??0};
}

async function validateAllocation(ctx:ServiceContext,invoice:Invoice,allocation:Allocation){
 const source=await original(ctx,invoice,allocation.paymentId);
 if(allocation.currency!==source.payment.currency || allocation.provider!==source.payment.provider || allocation.providerAccountId!==source.providerAccountId || allocation.applicationFeeMinor!==source.applicationFeeMinor) throw new ServiceError("conflict","The original return payment routing changed. Reconcile it before sending or recording a refund.");
 return source;
}

/** Recover only a whole, evidenced pre-68 plan; never manufacture a historical settlement. */
function legacyPlan(request:Request,invoice:Invoice,amountMinor:number){
 const refunds=invoice.refunds.filter(refund=>refund.idempotencyKey===`return:${request.id}:refund:${refund.paymentId}` || (refund.idempotencyKey.startsWith(`return:${request.id}:provider:`) && refund.idempotencyKey.endsWith(`:${refund.paymentId}`)));
 const active=refunds.filter(refund=>reserved(refund.status));
 const group=(rows:typeof refunds)=>{
  const amounts=new Map<string,number>();
  for(const refund of rows) amounts.set(refund.paymentId,sumMinor([amounts.get(refund.paymentId)??0,refund.amountMinor],"Original return allocation"));
  return [...amounts].map(([paymentId,amountMinor])=>({paymentId,amountMinor}));
 };
 if(sumMinor(active.map(refund=>refund.amountMinor),"Legacy reservations")===amountMinor) return group(active);
 const generations=new Map<string,typeof refunds>();
 for(const refund of refunds){
  const key=refund.idempotencyKey.slice(0,-refund.paymentId.length);
  generations.set(key,[...(generations.get(key)??[]),refund]);
 }
 const candidates=[...generations.values()].filter(rows=>sumMinor(rows.map(refund=>refund.amountMinor),"Legacy generation")===amountMinor).map(group)
  .filter(rows=>active.every(refund=>total(active,row=>row.paymentId===refund.paymentId)<=(rows.find(row=>row.paymentId===refund.paymentId)?.amountMinor??0)));
 const signatures=new Map(candidates.map(rows=>[JSON.stringify(rows.slice().sort((a,b)=>a.paymentId.localeCompare(b.paymentId))),rows]));
 if(signatures.size!==1) throw new ServiceError("conflict","The historical return allocation is ambiguous. Reconcile its original payments before retrying.");
 return [...signatures.values()][0]!;
}

async function freeze(ctx:ServiceContext,input:z.infer<typeof operation>,lockForSettlement=false){
 const state=await context(ctx,input.id,true);
 const {request,order,invoice}=state;
 if(request.status==="refunded") return {...state,allocations:await ctx.tx.select().from(returnRefundAllocations).where(eq(returnRefundAllocations.returnId,request.id))};
 if(request.status!=="received") throw new ServiceError("conflict","Receive the return before preparing its refund.");
 const allocations=await ctx.tx.select().from(returnRefundAllocations).where(eq(returnRefundAllocations.returnId,request.id));
 let credit=request.creditNoteId ? invoice.creditNotes.find(note=>note.id===request.creditNoteId) : undefined;
 if(request.creditNoteId && (!credit || credit.status==="void")) throw new ServiceError("conflict","Reconcile this return's original credit before refunding it.");
 const calculated=credit ? undefined : await returnCredit(ctx,request,invoice);
 const amountMinor=credit?.totalMinor ?? calculated!.amountMinor;
 if(!allocations.length){
  let proposed:Array<{paymentId:string,amountMinor:number}>;
  if(credit) proposed=legacyPlan(request,invoice,amountMinor);
  else {
   proposed=[];let remaining=amountMinor;
   const captured=invoice.payments.filter(payment=>payment.status==="succeeded").sort((a,b)=>a.createdAt.getTime()-b.createdAt.getTime() || a.id.localeCompare(b.id));
   const frozen=captured.length ? await ctx.tx.select().from(returnRefundAllocations).where(inArray(returnRefundAllocations.paymentId,captured.map(payment=>payment.id))) : [];
   for(const payment of captured){
    const owed=sumMinor(frozen.filter(part=>part.paymentId===payment.id).map(part=>Math.max(0,part.amountMinor-total(assigned(invoice,{id:part.returnId},part),row=>reserved(row.status)))),"Owed original return portions");
    const available=payment.amountMinor-total(invoice.refunds,row=>row.paymentId===payment.id && reserved(row.status))-owed;
    if(available<0) throw new ServiceError("conflict","Reconcile the original refund balance before preparing this return.");
    const amount=Math.min(remaining,available);
    if(amount>0){proposed.push({paymentId:payment.id,amountMinor:amount});remaining-=amount;}
   }
   if(remaining) throw new ServiceError("conflict","The original payments cannot cover this whole return.");
  }
  for(const part of proposed){
   const source=await original(ctx,invoice,part.paymentId);
   const [created]=await ctx.tx.insert(returnRefundAllocations).values({returnId:request.id,paymentId:part.paymentId,amountMinor:part.amountMinor,currency:invoice.invoice.currency,provider:source.payment.provider,providerAccountId:source.providerAccountId,applicationFeeMinor:source.applicationFeeMinor}).returning();
   allocations.push(created!);
  }
 }
 if(sumMinor(allocations.map(part=>part.amountMinor),"Frozen return allocation")!==amountMinor) throw new ServiceError("conflict","The frozen return allocations do not match its whole credit.");
 const requests=[];
 const generation=createHash("sha256").update(input.idempotencyKey).digest("hex");
 for(const allocation of allocations){
  await validateAllocation(ctx,invoice,allocation);
  const active=assigned(invoice,request,allocation).filter(refund=>reserved(refund.status));
  const held=total(active,()=>true);
  if(held>allocation.amountMinor) throw new ServiceError("conflict","A return payment has more reserved than its frozen allocation.");
  for(const refund of active) requests.push({paymentId:refund.paymentId,amountMinor:refund.amountMinor,reason:refund.reason??request.reason,idempotencyKey:refund.idempotencyKey});
  if(held<allocation.amountMinor) requests.push({paymentId:allocation.paymentId,amountMinor:allocation.amountMinor-held,reason:request.reason,idempotencyKey:`return:${request.id}:allocation:${allocation.id}:${generation}`});
 }
 // Lock all original balances before any invoice credit or settlement work.
 const attempts=await ctx.callAsSystem(reserveRefundBatch,{refunds:requests,lockForSettlement});
 if(attempts.some(refund=>!reserved(refund.status))) throw new ServiceError("conflict","This attempt was refused or cancelled. Reload the return to authorize another attempt for the remaining balance.");
 credit ??= await ctx.callAsSystem(createCreditNote,{invoiceId:invoice.invoice.id,idempotencyKey:`return:${request.id}:credit`,reason:request.reason,lines:calculated!.creditLines});
 await ctx.tx.update(returnRequests).set({creditNoteId:credit.id,refundId:request.refundId??attempts[0]!.id,updatedAt:sql`now()`}).where(eq(returnRequests.id,request.id));
 ctx.setSubject("return",request.id);
 if(!request.creditNoteId) await ctx.emitTimeline({contactId:request.contactId,eventType:"return.refundPrepared",subjectType:"return",subjectId:request.id,payload:{orderId:order.id,amountMinor,currency:invoice.invoice.currency,initiatedBy:actorString(ctx.actor)}});
 return {...state,request:{...request,creditNoteId:credit.id},allocations,invoice:await ctx.callAsSystem(getInvoice,{id:invoice.invoice.id})};
}

export const refundPlanSummary=z.object({prepared:z.boolean(),available:z.boolean(),currency:z.string(),amountMinor:money,offlineMinor:money,onlineMinor:money,offlineConfirmedMinor:money,onlineConfirmedMinor:money});
export const getReturnRefundPlan=defineService({
 name:"catalog.getReturnRefundPlan",summary:"Read masked original-payment totals for one return.",kind:"query",permission:"scoped",input:z.object({id}),output:refundPlanSummary,
 handler:async(input,ctx)=>{
  const {request,invoice}=await context(ctx,input.id);
  const allocations=await ctx.tx.select().from(returnRefundAllocations).where(eq(returnRefundAllocations.returnId,request.id));
  const credit=invoice.creditNotes.find(note=>note.id===request.creditNoteId);
  const summary={prepared:allocations.length>0,available:request.status==="received" || request.status==="refunded",currency:invoice.invoice.currency,amountMinor:credit?.totalMinor??0,offlineMinor:0,onlineMinor:0,offlineConfirmedMinor:0,onlineConfirmedMinor:0};
  if(!allocations.length) return summary;
  for(const allocation of allocations){
   const amount=total(assigned(invoice,request,allocation),refund=>refund.status==="succeeded");
   if(allocation.provider==="manual"){summary.offlineMinor+=allocation.amountMinor;summary.offlineConfirmedMinor+=amount;}
   else{summary.onlineMinor+=allocation.amountMinor;summary.onlineConfirmedMinor+=amount;}
  }
  return summary;
 },
});

export const prepareReturnRefund=defineService({
 name:"catalog.prepareReturnRefund",summary:"Freeze and reserve every original return payment before refunding money.",kind:"mutation",permission:"scoped",stepUp:true,agentCallable:false,writeClass:"money",input:operation,output:returnDetail,
 handler:async(input,ctx)=>{await freeze(ctx,input);return ctx.call(getReturn,{id:input.id});},
});

export const refundReturn=defineService({
 name:"catalog.refundReturn",summary:"Record the exact original offline portion already returned to the customer.",kind:"mutation",permission:"scoped",stepUp:true,agentCallable:false,writeClass:"money",
 input:operation.extend({offlineRefundConfirmed:z.literal(true),offlineRefundAmountMinor:money.optional()}),output:returnDetail,
 handler:async(input,ctx)=>{
  const {request,invoice,allocations}=await freeze(ctx,input,true);
  if(request.status==="refunded") return ctx.call(getReturn,{id:request.id});
  const offline=allocations.filter(part=>part.provider==="manual");
  if(!offline.length) throw new ServiceError("conflict","This return has no offline portion. Its original provider must confirm the refund.");
  const remaining=sumMinor(offline.map(part=>part.amountMinor-total(assigned(invoice,request,part),refund=>refund.status==="succeeded")),"Remaining offline return amount");
  if(remaining && ((allocations.length!==offline.length && input.offlineRefundAmountMinor===undefined) || (input.offlineRefundAmountMinor!==undefined && input.offlineRefundAmountMinor!==remaining))) throw new ServiceError("validation","Confirm the exact frozen offline amount before recording it.");
  for(const allocation of offline){
   for(const refund of assigned(invoice,request,allocation).filter(row=>row.status!=="succeeded" && reserved(row.status))) await ctx.callAsSystem(settleRefund,{id:refund.id,providerRef:`manual-return:${request.id}:${refund.id}`});
  }
  if(remaining) await ctx.emitTimeline({contactId:request.contactId,eventType:"return.offlineRefundRecorded",subjectType:"return",subjectId:request.id,payload:{amountMinor:remaining,currency:invoice.invoice.currency}});
  await ctx.callAsSystem(reconcileReturnProviderRefunds,{invoiceId:invoice.invoice.id});
  return ctx.call(getReturn,{id:request.id});
 },
});

const attempt=z.object({paymentId:id,amountMinor:money,reason:z.string(),idempotencyKey:z.string(),provider:z.string(),providerAccountId:z.string(),applicationFeeMinor:money,currency:z.string()});
export const claimReturnProviderRefund=defineService({
 name:"catalog.claimReturnProviderRefund",summary:"Reserve the frozen original online portion of one received return.",kind:"mutation",permission:"scoped",external:false,orchestratedBy:"catalog.submitReturnProviderRefund",stepUp:true,agentCallable:false,writeClass:"money",
 input:operation,output:z.object({invoiceId:id,attempts:z.array(attempt)}),
 handler:async(input,ctx)=>{
  const {request,invoice,allocations}=await freeze(ctx,input);
  const attempts: z.infer<typeof attempt>[]=[];
  if(request.status!=="refunded") for(const allocation of allocations.filter(part=>part.provider!=="manual")){
   for(const refund of assigned(invoice,request,allocation).filter(row=>reserved(row.status))) attempts.push({paymentId:refund.paymentId,amountMinor:refund.amountMinor,reason:refund.reason??request.reason,idempotencyKey:refund.idempotencyKey,provider:allocation.provider,providerAccountId:allocation.providerAccountId,applicationFeeMinor:allocation.applicationFeeMinor,currency:allocation.currency});
  }
  return {invoiceId:invoice.invoice.id,attempts};
 },
});

export const reconcileReturnProviderRefunds=defineService({
 name:"catalog.reconcileReturnProviderRefunds",summary:"Close a frozen return only when every original tender amount is confirmed.",kind:"mutation",permission:"system",external:false,input:z.object({invoiceId:id}),output:z.object({changed:z.number().int()}),
 handler:async(input,ctx)=>{
  const [order]=await ctx.tx.select().from(orders).where(eq(orders.invoiceId,input.invoiceId)).for("update");
  if(!order) return {changed:0};
  const requests=await ctx.tx.select().from(returnRequests).where(and(eq(returnRequests.orderId,order.id),eq(returnRequests.status,"received"))).for("update");
  const invoice=await ctx.callAsSystem(getInvoice,{id:input.invoiceId});let changed=0;
  for(const request of requests){
   if(!request.creditNoteId) continue;
   const credit=invoice.creditNotes.find(note=>note.id===request.creditNoteId);
   if(!credit || credit.status==="void") throw new ServiceError("conflict","The return credit needs reconciliation before it can close.");
   const allocations=await ctx.tx.select().from(returnRefundAllocations).where(eq(returnRefundAllocations.returnId,request.id));
   if(!allocations.length){
    for(const part of legacyPlan(request,invoice,credit.totalMinor)){
     const source=await original(ctx,invoice,part.paymentId);
     const [allocation]=await ctx.tx.insert(returnRefundAllocations).values({returnId:request.id,...part,currency:invoice.invoice.currency,provider:source.payment.provider,providerAccountId:source.providerAccountId,applicationFeeMinor:source.applicationFeeMinor}).returning();allocations.push(allocation!);
    }
   }
   if(sumMinor(allocations.map(part=>part.amountMinor),"Return credit allocation")!==credit.totalMinor) throw new ServiceError("conflict","The original return allocation does not cover its whole credit.");
   let complete=true;const refundIds:string[]=[];
   for(const allocation of allocations){
    await validateAllocation(ctx,invoice,allocation);
    const rows=assigned(invoice,request,allocation);
    if(total(rows,row=>reserved(row.status))>allocation.amountMinor) throw new ServiceError("conflict","The original return payment is over-reserved.");
    if(total(rows,row=>row.status==="succeeded")!==allocation.amountMinor) complete=false;
    refundIds.push(...rows.filter(row=>row.status==="succeeded").map(row=>row.id));
   }
   if(!complete) continue;
   await ctx.callAsSystem(issueCreditNote,{id:credit.id});
   await ctx.tx.update(returnRequests).set({status:"refunded",updatedAt:sql`now()`}).where(eq(returnRequests.id,request.id));
   await ctx.emitTimeline({contactId:request.contactId,eventType:"return.refunded",subjectType:"return",subjectId:request.id,payload:{orderId:order.id,creditNoteId:credit.id,refundIds}});
   await notifyReturnRefund(ctx,request.contactId,request.id);
   ctx.queueEvent("catalog.returnRefunded",{returnId:request.id,creditNoteId:credit.id,refundId:refundIds[0]});changed++;
  }
  if(changed && invoice.invoice.status==="refunded"){
   const pending=await ctx.tx.select().from(returnRequests).where(and(eq(returnRequests.orderId,order.id),ne(returnRequests.status,"refunded"),ne(returnRequests.status,"rejected")));
   if(!pending.length) await ctx.tx.update(orders).set({status:"refunded",updatedAt:sql`now()`}).where(eq(orders.id,order.id));
  }
  return {changed};
 },
});

export const submitReturnProviderRefund=defineOrchestratedService({
 name:"catalog.submitReturnProviderRefund",summary:"Refund only the frozen original online portions of a received return.",kind:"mutation",permission:"scoped",stepUp:true,agentCallable:false,writeClass:"money",input:operation,output:returnDetail,
 handler:async(input,caller)=>{
  const system={kind:"system",request:caller.request} as const;
  const claimed=await claimReturnProviderRefund.call(input,caller);
  for(const attempt of claimed.attempts){
   const source=await providerPaymentSource.call({paymentId:attempt.paymentId},system);
   if(source.payment.provider!==attempt.provider || source.payment.currency!==attempt.currency || (source.routing.providerAccountId??"")!==attempt.providerAccountId || (source.routing.applicationFeeMinor??0)!==attempt.applicationFeeMinor) throw new ServiceError("conflict","The frozen original payment route changed before refund processing.");
   const request={paymentId:attempt.paymentId,amountMinor:attempt.amountMinor,reason:attempt.reason,idempotencyKey:attempt.idempotencyKey};
   if(attempt.provider==="balance") await refundCustomerBalancePayment.call(request,system);
   else await submitProviderRefund.call(request,system);
  }
  await reconcileReturnProviderRefunds.call({invoiceId:claimed.invoiceId},system);
  return getReturn.call({id:input.id},system);
 },
});
export async function onReturnRefundSucceeded(payload:unknown):Promise<void>{const invoiceId=(payload as {invoiceId?:string}|null)?.invoiceId;if(invoiceId) await reconcileReturnProviderRefunds.call({invoiceId},{kind:"system"});}
export default [getReturnRefundPlan,prepareReturnRefund,refundReturn,claimReturnProviderRefund,reconcileReturnProviderRefunds,submitReturnProviderRefund];

