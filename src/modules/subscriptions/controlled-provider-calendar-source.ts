// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Project only an independently returned actual original read, retaining its SHA.
import { z } from "zod";
import { ServiceError } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { assertControlledCurrent } from "@/adapters/payments/controlled-subscription-current";
import type { MerchantControlledSubscriptionScope } from "@/adapters/payments";
import { controlledCalendarPayload } from "./controlled-provider-adapter-contract";
import type { controlledProviderJournal } from "./controlled-provider-proof";
import type { subscriptionCommercialTerms } from "./schema";
type History=Awaited<ReturnType<typeof controlledProviderJournal>>;
const reference=z.union([z.string(),z.object({id:z.string()}).passthrough()]).transform(value=>typeof value==="string"?value:value.id);
const epoch=z.number().int().nonnegative().max(8640000000000).transform(value=>new Date(value*1000).toISOString());
const rawCalendar=z.object({
 id:z.string(),billing_cycle_anchor:epoch,trial_end:epoch.nullable(),
 items:z.object({has_more:z.literal(false),data:z.array(z.object({
  id:z.string(),quantity:z.literal(1),current_period_start:epoch,current_period_end:epoch,
  price:z.object({id:z.string(),product:reference,unit_amount:z.number().int().nonnegative(),
   recurring:z.object({interval:z.enum(["day","week","month","year"]),interval_count:z.number().int().positive()}).passthrough(),
  }).passthrough(),
 }).passthrough()).length(1)}).passthrough(),
}).passthrough();
/** No newest ACK, later successful unrelated read or amount match can supply
 * this authority. The journal already verifies each original signed finish. */
export function controlledCalendarSource(history:History,scope:MerchantControlledSubscriptionScope,terms:typeof subscriptionCommercialTerms.$inferSelect,target:{providerProductRef:string;principalMinor:number;interval:"day"|"week"|"month"|"year";intervalCount:number},at:string,options?:{observationOnly:true}){
 const verification=history.verifications.filter(row=>history.operations.some(op=>op.id===row.operationId&&op.kind==="read_calendar")).at(-1);
 const actual=verification?z.record(z.string(),z.unknown()).safeParse(verification.actualResult.actualRaw):null;
 const bootstrap=history.operations.find(op=>op.kind==="bootstrap");
 if(!verification||!actual?.success||!bootstrap||verification.actualResult.currentReadDigest!==merchantTaxDigest(actual.data)||history.unfinished.length||history.closures.length)
  throw new ServiceError("conflict","Independently read this actual original paused calendar after every real older caller returned or was genuinely stopped.");
 const parsed=rawCalendar.parse(actual.data),item=parsed.items.data[0]!;
 const payload=controlledCalendarPayload.parse({bootstrapOperationId:bootstrap.id,bootstrapRequestDigest:bootstrap.requestDigest,providerSubscriptionRef:parsed.id,
  originalComponents:[{kind:"principal",subscriptionItemRef:item.id,providerPriceRef:item.price.id,providerProductRef:item.price.product,amountMinor:item.price.unit_amount,interval:item.price.recurring.interval,intervalCount:item.price.recurring.interval_count,
   actualPeriodStart:item.current_period_start,actualPeriodEnd:item.current_period_end,taxQuoteDigest:terms.initialTaxQuote.quoteDigest,profileId:terms.profileId,profileVersion:terms.profileVersion}],
  originalAnchor:parsed.billing_cycle_anchor,originalProviderTrialEnd:parsed.trial_end,originalPeriodStart:item.current_period_start,originalPeriodEnd:item.current_period_end,
  prorationAt:at,currentReadDigest:merchantTaxDigest(actual.data),target,taxComponent:null});
 if(!options?.observationOnly)assertControlledCurrent({...scope,...payload,operationId:verification.operationId,requestDigest:history.operations.find(op=>op.id===verification.operationId)!.requestDigest,idempotencyKey:"read-projection-only"},actual.data);
 return{payload,verification,actualRaw:actual.data};
}
