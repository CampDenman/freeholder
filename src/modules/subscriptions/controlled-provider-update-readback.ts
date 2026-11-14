// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A fresh bank GET proves actual update effects; it never invents the old finish.
import { z } from "zod";
import { controlledCalendarSource } from "./controlled-provider-calendar-source";
import type { controlledCollectionState } from "./controlled-provider-collection-state";
export function controlledUpdateReadback(source:Awaited<ReturnType<typeof controlledCollectionState>>){
 const{history,collection,review,resource}=source;
 const updates=history.operations.filter(op=>op.kind==="update_calendar"&&history.calls.some(call=>call.operationId===op.id)&&z.record(z.string(),z.unknown()).parse(op.originalRequest.payload).collectionId===collection.id);
 if(updates.length!==1)return null;const update=updates[0]!;
 const read=history.operations.filter(op=>op.kind==="read_calendar"&&op.ordinal>update.ordinal).at(-1),verification=read?history.verifications.find(row=>row.operationId===read.id):null;
 if(!read||!verification||history.unfinished.length||history.closures.length)return null;
 const raw=z.record(z.string(),z.unknown()).parse(verification.actualResult.actualRaw),tag=z.record(z.string(),z.unknown()).parse(raw.metadata);
 if(tag.freeholder_controlled_price_epoch_id!==collection.id||tag.freeholder_controlled_update_operation_id!==update.id
  ||tag.freeholder_controlled_update_request_digest!==update.requestDigest||tag.freeholder_controlled_accepted_quote_digest!==collection.acceptedQuoteDigest
  ||tag.freeholder_controlled_collection_policy!==collection.collectionPolicy)return null;
 const target={providerProductRef:resource.originalScope.providerProductRef,principalMinor:review.quote.snapshot.periodAmountMinor,interval:review.quote.snapshot.interval,intervalCount:review.quote.snapshot.intervalCount};
 const calendar=controlledCalendarSource(history,resource.originalScope,source.terms,target,review.effectiveAt).payload,item=calendar.originalComponents[0]!;
 if(item.amountMinor!==target.principalMinor||item.providerProductRef!==target.providerProductRef||item.interval!==target.interval||item.intervalCount!==target.intervalCount
  ||calendar.originalAnchor!==review.calendar.expectedProviderBillingAnchor||calendar.originalProviderTrialEnd!==review.calendar.expectedProviderTrialEndsAt
  ||!(calendar.originalPeriodStart===review.calendar.expectedProviderPeriodStart&&calendar.originalPeriodEnd===review.calendar.expectedProviderPeriodEnd
   ||collection.kind==="period"&&review.calendar.nativeForecasts.some(row=>!row.proration&&row.amountMinor===target.principalMinor&&row.periodStart===calendar.originalPeriodStart&&row.periodEnd===calendar.originalPeriodEnd)))return null;
 return{updateOperationId:update.id,readOperationId:read.id,readResultDigest:verification.actualResultDigest,providerInvoiceRef:verification.actualResult.providerInvoiceRef??null};
}
