// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: immutable original cumulative epoch, explicit actual retirement.
import {ServiceError} from "@/core/service";
export type LegacyAtomicCreditFeeLoan={kind:"legacy";fundingId:string;principalMinor:number;assignedFeeMinor:number;provenCollectedMinor:number};
export type AtomicCreditFeeLoan={kind:"atomic";fundingId:string;principalMinor:number;assignedFeeMinor:number;provenCollectedMinor:number;nominalFeeMinor:number;retiredShareMinor:number;retiredAtBirthMinor:number;priorFundingIds:readonly string[]};
export type AtomicCreditFeeCapacityInput={originalPrincipalMinor:number;originalFeeMinor:number;acceptedRetiredFeeMinor:number;actualCollectedFeeMinor:number;loans:readonly (LegacyAtomicCreditFeeLoan|AtomicCreditFeeLoan)[];takeMinor:number};
function refuse():never{throw new ServiceError("conflict","Restore the exact original credit fee epoch, authenticated prior funding set and real retired/assigned/collected capacity; an old loan cannot be repriced or forgiven.");}
/** No identity, HMAC, bank, principal or writer authority is supplied here.
 * Actual readers authenticate every real loan and prefix BEFORE this math. */
export function atomicCreditFeeCapacities(input:AtomicCreditFeeCapacityInput){
 const safe=(values:readonly number[])=>values.every(value=>Number.isSafeInteger(value)&&value>=0);
 if(!safe([input.originalPrincipalMinor,input.originalFeeMinor,input.acceptedRetiredFeeMinor,input.actualCollectedFeeMinor,input.takeMinor])||input.originalPrincipalMinor<=0||input.originalFeeMinor>input.originalPrincipalMinor
  ||input.acceptedRetiredFeeMinor>input.originalFeeMinor||input.actualCollectedFeeMinor>input.originalFeeMinor-input.acceptedRetiredFeeMinor||input.loans.length>5000
  ||input.loans.some(row=>!row.fundingId)||new Set(input.loans.map(row=>row.fundingId)).size!==input.loans.length)refuse();
 const principal=BigInt(input.originalPrincipalMinor),originalFee=BigInt(input.originalFeeMinor),retired=BigInt(input.acceptedRetiredFeeMinor),collected=BigInt(input.actualCollectedFeeMinor);
 const legacy=input.loans.filter(row=>row.kind==="legacy"),atomic=input.loans.filter((row):row is AtomicCreditFeeLoan=>row.kind==="atomic").sort((a,b)=>a.priorFundingIds.length-b.priorFundingIds.length);
 for(const row of input.loans)if(!safe([row.principalMinor,row.assignedFeeMinor,row.provenCollectedMinor])||row.principalMinor<=0||row.assignedFeeMinor>row.principalMinor||row.provenCollectedMinor>row.assignedFeeMinor)refuse();
 let allocatedPrincipal=legacy.reduce((sum,row)=>sum+BigInt(row.principalMinor),0n),allocatedNominal=legacy.reduce((sum,row)=>sum+BigInt(row.assignedFeeMinor),0n),allocatedActual=allocatedNominal,declaredProven=legacy.reduce((sum,row)=>sum+BigInt(row.provenCollectedMinor),0n),retiredAtPriorBirth=0n;
 if(allocatedPrincipal>principal||allocatedNominal!==originalFee*allocatedPrincipal/principal)refuse();
 const seen=new Set(legacy.map(row=>row.fundingId));
 for(const row of atomic){
  if(!safe([row.nominalFeeMinor,row.retiredShareMinor,row.retiredAtBirthMinor])||new Set(row.priorFundingIds).size!==row.priorFundingIds.length||row.priorFundingIds.length!==seen.size||row.priorFundingIds.some(id=>!seen.has(id)))refuse();
  const birthRetired=BigInt(row.retiredAtBirthMinor);if(birthRetired<retiredAtPriorBirth||birthRetired>retired)refuse();
  const afterPrincipal=allocatedPrincipal+BigInt(row.principalMinor);if(afterPrincipal>principal)refuse();
  const nominal=originalFee*afterPrincipal/principal-allocatedNominal,available=originalFee-birthRetired-allocatedActual;if(available<0n)refuse();
  const actual=nominal<available?nominal:available;
  if(BigInt(row.nominalFeeMinor)!==nominal||BigInt(row.assignedFeeMinor)!==actual||BigInt(row.retiredShareMinor)!==nominal-actual)refuse();
  allocatedPrincipal=afterPrincipal;allocatedNominal+=nominal;allocatedActual+=actual;declaredProven+=BigInt(row.provenCollectedMinor);retiredAtPriorBirth=birthRetired;seen.add(row.fundingId);
 }
 const availablePrincipal=principal-allocatedPrincipal,availableActualFee=originalFee-retired-allocatedActual;
 if(availablePrincipal<0n||availableActualFee<0n||declaredProven>collected||allocatedNominal-allocatedActual>retired||BigInt(input.takeMinor)>availablePrincipal)refuse();
 const takeNominal=originalFee*(allocatedPrincipal+BigInt(input.takeMinor))/principal-allocatedNominal,takeActual=takeNominal<availableActualFee?takeNominal:availableActualFee;
 // Collection follows the same original obligation prefix. A missing old
 // collected receipt cannot make its reserved fee available a second time.
 const remainingCollected=collected>allocatedActual?collected-allocatedActual:0n,takeProven=takeActual<remainingCollected?takeActual:remainingCollected;
 return{originalPrincipalMinor:input.originalPrincipalMinor,originalFeeMinor:input.originalFeeMinor,acceptedRetiredFeeMinor:input.acceptedRetiredFeeMinor,actualCollectedFeeMinor:input.actualCollectedFeeMinor,
  allocatedPrincipalMinor:Number(allocatedPrincipal),allocatedNominalFeeMinor:Number(allocatedNominal),allocatedRetiredFeeMinor:Number(allocatedNominal-allocatedActual),allocatedAssignedFeeMinor:Number(allocatedActual),declaredProvenFeeMinor:Number(declaredProven),
  currentCoveredAssignedFeeMinor:Number(allocatedActual<collected?allocatedActual:collected),currentOwedAssignedFeeMinor:Number(allocatedActual>collected?allocatedActual-collected:0n),availablePrincipalMinor:Number(availablePrincipal),availableActualFeeMinor:Number(availableActualFee),
  takePrincipalMinor:input.takeMinor,takeNominalFeeMinor:Number(takeNominal),takeRetiredFeeMinor:Number(takeNominal-takeActual),takeAssignedFeeMinor:Number(takeActual),takeProvenCollectedMinor:Number(takeProven),takeOwedFeeMinor:Number(takeActual-takeProven),
  afterPrincipalMinor:Number(allocatedPrincipal+BigInt(input.takeMinor)),afterNominalFeeMinor:Number(allocatedNominal+takeNominal),afterAssignedFeeMinor:Number(allocatedActual+takeActual),remainingPrincipalMinor:Number(availablePrincipal-BigInt(input.takeMinor)),remainingActualFeeMinor:Number(availableActualFee-takeActual),priorFundingIds:[...seen].sort()};
}
