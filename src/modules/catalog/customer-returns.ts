// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Customers request and follow only their own returns; all lifecycle changes reuse the owner services.
import {and,eq,ne} from "drizzle-orm";
import {z} from "zod";
import {contactForActor} from "@/core/portal/service";
import {defineService,ServiceError,type ServiceContext} from "@/core/service";
import {orders,orderItems,returnRequests,returnItems} from "./schema";
import {requestReturn} from "./fulfillment";
import {getReturnRefundPlan} from "./return-refunds";
import {RETURN_STATUSES} from "./contract";
const id=z.uuid();
const input=z.object({orderId:id});
async function ownOrder(ctx:ServiceContext,orderId:string){
 const contact=await contactForActor(ctx);
 const [order]=await ctx.tx.select().from(orders).where(and(eq(orders.id,orderId),eq(orders.contactId,contact.id)));
 if(!order)throw new ServiceError("not_found","That order is not here.");
 return order;
}
const item=z.object({id,description:z.string(),quantity:z.number().int(),available:z.number().int().min(0)});
const detail=z.object({id,status:z.enum(RETURN_STATUSES),reason:z.string(),labelUrl:z.string().nullable(),items:z.array(z.object({orderItemId:id,quantity:z.number().int()})),refund:z.object({amountMinor:z.number().int(),confirmedMinor:z.number().int(),currency:z.string()})});
export const myOrderReturns=defineService({
 name:"catalog.myOrderReturns",summary:"Your own order's returnable lines and return progress, without payment routing or other customers' data.",kind:"query",permission:"authenticated",input,
 output:z.object({orderId:id,canRequest:z.boolean(),items:z.array(item),returns:z.array(detail)}),
 handler:async({orderId},ctx)=>{
  const order=await ownOrder(ctx,orderId);
  const lines=await ctx.tx.select().from(orderItems).where(eq(orderItems.orderId,order.id));
  const requests=await ctx.tx.select().from(returnRequests).where(eq(returnRequests.orderId,order.id));
  const allocated=await ctx.tx.select({orderItemId:returnItems.orderItemId,quantity:returnItems.quantity}).from(returnItems).innerJoin(returnRequests,eq(returnRequests.id,returnItems.returnId)).where(and(eq(returnRequests.orderId,order.id),ne(returnRequests.status,"rejected")));
  const result=[];
  for(const request of requests){
   const items=await ctx.tx.select({orderItemId:returnItems.orderItemId,quantity:returnItems.quantity}).from(returnItems).where(eq(returnItems.returnId,request.id));
   const plan=await ctx.callAsSystem(getReturnRefundPlan,{id:request.id});
   let labelUrl:string|null=null;
   if(request.labelUrl){try{const url=new URL(request.labelUrl);if(["https:","http:"].includes(url.protocol)&&!url.username&&!url.password)labelUrl=url.href;}catch{/* An unsafe historical label is never a customer link. */}}
   result.push({id:request.id,status:request.status,reason:request.reason,labelUrl,items,refund:{amountMinor:plan.amountMinor,confirmedMinor:plan.offlineConfirmedMinor+plan.onlineConfirmedMinor,currency:order.currency}});
  }
  return {orderId:order.id,canRequest:["paid","fulfilling","fulfilled"].includes(order.status),items:lines.map(line=>({id:line.id,description:typeof line.snapshot.productName==="string"?line.snapshot.productName:line.variantId.slice(0,8),quantity:line.quantity,available:Math.max(0,line.quantity-allocated.filter(row=>row.orderItemId===line.id).reduce((n,row)=>n+row.quantity,0))})),returns:result};
 },
});
export const requestMyReturn=defineService({
 name:"catalog.requestMyReturn",summary:"Ask to return lines from your own paid order; the owner decides receipt, restocking and refunds.",kind:"mutation",permission:"authenticated",input:input.extend({reason:z.string().trim().min(3).max(1000),items:z.array(z.object({orderItemId:id,quantity:z.number().int().min(1).max(1000000)})).min(1)}),output:z.object({id}),
 handler:async(input,ctx)=>{
  await ownOrder(ctx,input.orderId);
  const result=await ctx.callAsSystem(requestReturn,{...input,restock:false});
  ctx.setSubject("return",result.return.id);
  return {id:result.return.id};
 },
});
export default [myOrderReturns,requestMyReturn];
