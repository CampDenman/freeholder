// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Actual native price/calendar evidence and canonical full original period price.
import { ServiceError,type ServiceContext } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import type { controlledPeriodInput } from "./controlled-provider-collection-contract";
import { controlledCalendarPayload } from "./controlled-provider-adapter-contract";
import { controlledActualPreview } from "./controlled-provider-preview-contract";
import { controlledNativeAmounts } from "./controlled-provider-native-amounts";
import { controlledPeriodSource,refuseControlledPeriod } from "./controlled-provider-period-source";
import { periodEnd } from "./calendar";
import type { z } from "zod";
export async function controlledPeriodEconomics(ctx:ServiceContext,input:z.input<typeof controlledPeriodInput>,evidence:{calendarOperationId:string;customerOperationId:string;nativeOperationId:string;updateOperationId:string}){
 const source=await controlledPeriodSource(ctx,input),{history,terms,resource}=source;
 function returned(id:string,kind:string){const operation=history.operations.find(row=>row.id===id),verification=history.verifications.find(row=>row.operationId===id);if(!operation||operation.kind!==kind||!verification)refuseControlledPeriod();return{operation,verification};}
 const native=returned(evidence.nativeOperationId,"preview_proration"),update=returned(evidence.updateOperationId,"preview_update"),calendar=returned(evidence.calendarOperationId,"read_calendar"),customer=returned(evidence.customerOperationId,"read_customer_financials");
 for(const proof of [native,update])if(proof.operation.originalRequest.targetInputDigest!==merchantTaxDigest(source.input)||proof.operation.originalRequest.periodSourceId!==source.sourceId
  ||proof.operation.originalRequest.originalPeriodConsentDigest!==terms.acceptedQuoteDigest||proof.operation.originalRequest.economicQuoteDigest!==terms.acceptedQuoteDigest)refuseControlledPeriod();
 const request=controlledCalendarPayload.parse(native.operation.originalRequest.payload),none=controlledCalendarPayload.parse(update.operation.originalRequest.payload),latestCalendar=history.verifications.filter(row=>history.operations.some(operation=>operation.id===row.operationId&&operation.kind==="read_calendar")).at(-1);
 if(merchantTaxDigest(request)!==merchantTaxDigest(none)||request.prorationAt!==source.input.previewAt||request.currentReadDigest!==calendar.verification.actualResult.currentReadDigest
  ||latestCalendar?.actualResult.currentReadDigest!==request.currentReadDigest||calendar.verification.actualResult.collectionPausedAsDraft!==true||calendar.verification.actualResult.calendarCanceled!==false
  ||request.target.principalMinor!==terms.snapshot.periodAmountMinor||request.target.interval!==terms.snapshot.interval||request.target.intervalCount!==terms.snapshot.intervalCount
  ||customer.verification.actualResult.providerCustomerRef!==resource.originalScope.providerCustomerRef||customer.verification.actualResult.balanceState!=="known_zero"||customer.verification.actualResult.completeCreditNotes!==true)refuseControlledPeriod();
 const actualNative=controlledActualPreview.parse(native.verification.actualResult),actualUpdate=controlledActualPreview.parse(update.verification.actualResult),actual=controlledNativeAmounts({...resource.originalScope,...request,operationId:native.operation.id,requestDigest:native.operation.requestDigest,idempotencyKey:native.operation.idempotencyKey},actualNative,actualUpdate);
 // A native current-window proration is only a hypothetical calendar-update
 // estimate. This original mandate buys the full canonical NEXT period. Its
 // exact physical draft later has canonical dates/NET/setup/tax; estimates and
 // transitional provider drafts never acquire an additional customer claim.
 const fullForecast=actualNative.actualLines.find(line=>!line.proration&&line.component==="principal"&&line.amountMinor===terms.snapshot.periodAmountMinor
  &&periodEnd(new Date(line.periodStart),terms.snapshot.interval,terms.snapshot.intervalCount).toISOString()===line.periodEnd&&Date.parse(line.periodStart)>=source.previewAt.getTime());
 if(!fullForecast)throw new ServiceError("conflict","Retain an actual complete original-price recurring forecast and its real provider interval before preparing the original full period; a partial native estimate is not its invoice.");
 const sourceRevision=merchantTaxDigest({originalEconomics:source.economicsRevision,input:source.input,actualCalendar:request,nativeResultDigest:native.verification.actualResultDigest,updateResultDigest:update.verification.actualResultDigest,customerFinancialDigest:customer.verification.actualResult.inventoryDigest,fullForecast});
 return{...source,request,actualNative,actualUpdate,actual,native,update,calendar,customer,fullForecast,sourceRevision};
}
