// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. MAC/epoch controls supply no current source or bank authority.
import {describe,expect,it} from "vitest";
import type {AtomicCreditFeeEconomicPlan} from "@/modules/invoicing/atomic-credit-fee-partition-contract";
import {atomicCreditFeeCapacities} from "@/modules/invoicing/atomic-credit-fee-amounts";
import {signAtomicCreditFeePartition,verifiedAtomicCreditFeePartition} from "@/modules/invoicing/atomic-credit-fee-partition-proof";
import {ATOMIC_CREDIT_FEE_PROTOCOL} from "@/modules/invoicing/atomic-credit-fee-protocol";
import {merchantTaxDigest} from "@/modules/invoicing/merchant-tax-store";
const id=(n:number)=>`00000000-0000-4000-8000-${n.toString().padStart(12,"0")}`,sha="a".repeat(64),key="fictional-original-credit-purpose-key";
function original(){
 const amounts=atomicCreditFeeCapacities({originalPrincipalMinor:4199,originalFeeMinor:400,acceptedRetiredFeeMinor:1,actualCollectedFeeMinor:399,loans:[],takeMinor:4199});
 const economic:Omit<AtomicCreditFeeEconomicPlan,"economicRevision">={protocol:ATOMIC_CREDIT_FEE_PROTOCOL,epochKind:"direct" as const,sourcePaymentId:id(2),sourceApplicationId:null,parentFundingId:null,sourceCollectionId:id(3),sourceResourceId:id(4),rootKind:"payment" as const,rootApplicationId:null,legacyApplicationRevision:null,legacyApplicationProof:null,rootFundingId:null,rootEconomicRevision:null,originalRootPrincipalMinor:4199,originalRootFeeMinor:400,sourceSegments:[],takeSegments:[],originalPaymentFeeMinor:400,originalResourceRetiredFeeMinor:1,...amounts,retiredResources:[]};
 const plan={...economic,economicRevision:merchantTaxDigest(economic)};
 return{fundingId:id(1),sourcePaymentId:id(2),sourceApplicationId:null,sourceInvoiceId:id(5),creditNoteId:id(6),creditNoteLineId:id(7),originalChargeReceiptId:id(8),bankInspectionId:id(9),bankObservationId:id(10),protocol:ATOMIC_CREDIT_FEE_PROTOCOL,parentFingerprint:sha,
  economics:{plan,currentParentRevision:sha,postgresSourceRevision:sha,beforeInvoiceProjections:[],beforeProrationProjections:[],beforeSubscriptionProjections:[],currentFeeProofRevision:sha,bankNamespaceRevision:sha,sourceGraphRevision:sha,feeEvidenceDigest:sha,
   birthDeclaration:{quoteId:id(11),plannedFundingId:id(1),prorationId:id(12),sourcePrincipalId:id(13),creditNoteId:id(6),creditNoteLineId:id(7),declarationDigest:sha,declarationAuthentication:sha,quoteFingerprint:sha}},
  beforeEntries:[{key:`payments:${id(2)}`,postgres_row:sha}],admissionTransactionId:"123",createdAt:new Date("2026-11-14T00:00:00Z")};
}
const signed=()=>{const row=original();return{...row,...signAtomicCreditFeePartition(row,key)};};
describe("exact original fee-epoch purpose signatures",()=>{
 it("retains nominal400 retired1 assigned399 without repricing the original root",()=>{const row=signed();expect(verifiedAtomicCreditFeePartition(row,["old-unrelated",key])).toBe(true);expect(row.economics.plan).toMatchObject({originalFeeMinor:400,takeNominalFeeMinor:400,takeRetiredFeeMinor:1,takeAssignedFeeMinor:399,takeProvenCollectedMinor:399});});
 it("refuses physical parent, current namespace and planned-birth substitutions under an old MAC",()=>{const row=signed();for(const changed of [{...row,parentFingerprint:"b".repeat(64)},{...row,economics:{...row.economics,bankNamespaceRevision:"b".repeat(64)}},{...row,economics:{...row.economics,birthDeclaration:{...row.economics.birthDeclaration,plannedFundingId:id(30)}}}])expect(verifiedAtomicCreditFeePartition(changed,[key])).toBe(false);});
 it("refuses even freshly signed own-parent preimages and ambiguous duplicate domain identities",()=>{const row=original();for(const beforeEntries of [[...row.beforeEntries,{key:`invoice_credit_funding:${row.fundingId}`,postgres_row:sha}],[...row.beforeEntries,...row.beforeEntries]]){const changed={...row,beforeEntries};expect(verifiedAtomicCreditFeePartition({...changed,...signAtomicCreditFeePartition(changed,key)},[key])).toBe(false);}});
 it("refuses freshly signed retirement forgiveness and a fake old-application downgrade",()=>{const row=original();for(const plan of [{...row.economics.plan,takeAssignedFeeMinor:400},{...row.economics.plan,rootKind:"legacy_application" as const}]){const{economicRevision:ignored,...body}=plan;void ignored;const changed={...row,economics:{...row.economics,plan:{...body,economicRevision:merchantTaxDigest(body)}}};expect(verifiedAtomicCreditFeePartition({...changed,...signAtomicCreditFeePartition(changed,key)},[key])).toBe(false);}});
 it("refuses unbounded before evidence and a foreign credential even with intact business identities",()=>{const row=original(),changed={...row,beforeEntries:Array.from({length:5001},(_,n)=>({key:`payments:${id(n+100)}`,postgres_row:sha}))};expect(verifiedAtomicCreditFeePartition({...changed,...signAtomicCreditFeePartition(changed,key)},[key])).toBe(false);expect(verifiedAtomicCreditFeePartition(signed(),["foreign-key"])).toBe(false);});
});
