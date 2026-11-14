// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN: MAC checks do not claim real database/current bank authority.
import {describe,expect,it} from "vitest";
import type {invoiceCreditReservationAtomicFeePartitions} from "@/modules/invoicing/atomic-credit-reservation-schema";
import {ATOMIC_CREDIT_RESERVATION_PROTOCOL} from "@/modules/invoicing/atomic-credit-fee-protocol";
import type {AtomicCreditReservationEconomics} from "@/modules/invoicing/atomic-credit-reservation-contract";
import {atomicCreditFeeSegmentTotals,originalAtomicCreditFeeSegment} from "@/modules/invoicing/atomic-credit-reservation-segments";
import {signAtomicCreditReservation,verifiedAtomicCreditReservation} from "@/modules/invoicing/atomic-credit-reservation-proof";
import {merchantTaxDigest} from "@/modules/invoicing/merchant-tax-store";
type Row=typeof invoiceCreditReservationAtomicFeePartitions.$inferSelect;
const fundingId="11111111-1111-4111-8111-111111111111",reservationId="22222222-2222-4222-8222-222222222222",paymentId="33333333-3333-4333-8333-333333333333";
const sha="a".repeat(64),key="fictional-reservation-proof-test-key";
function receipt():Row{
 const root={originalPrincipalMinor:4199,originalFeeMinor:400},segments=[originalAtomicCreditFeeSegment(root,{epochFundingId:fundingId,epochStartMinor:0,epochEndMinor:4199,epochAssignedFeeMinor:399,epochProvenCollectedMinor:399},0,21)];
 const economicBody:Omit<AtomicCreditReservationEconomics,"economicRevision">={protocol:ATOMIC_CREDIT_RESERVATION_PROTOCOL,rootKind:"payment",rootApplicationId:null,legacyApplicationRevision:null,rootFundingId:fundingId,sourcePaymentId:paymentId,...root,rootEconomicRevision:sha,fundingId,sourceApplicationId:null,fundingEconomicRevision:sha,
  fundingNominalFeeMinor:400,fundingRetiredFeeMinor:1,fundingAssignedFeeMinor:399,fundingProvenCollectedMinor:399,fundingOwedFeeMinor:0,segments,...atomicCreditFeeSegmentTotals(segments),activeReservationIds:[],releasedReservationIds:[],currentSourceRevision:sha,postgresSourceRevision:sha,beforeInvoiceProjections:[]};
 const body:Omit<Row,"digest"|"authentication">={reservationId,fundingId,rootFundingId:fundingId,sourcePaymentId:paymentId,sourceApplicationId:null,protocol:ATOMIC_CREDIT_RESERVATION_PROTOCOL,parentFingerprint:sha,fundingPartitionFingerprint:sha,
  economics:{...economicBody,economicRevision:merchantTaxDigest(economicBody)},beforeEntries:[{key:`invoice_credit_funding:${fundingId}`,postgres_row:sha}],admissionTransactionId:"123",createdAt:new Date("2026-11-14T00:00:00Z")};
 return{...body,...signAtomicCreditReservation(body,key)};
}
describe("original reservation purpose MAC and exact no-own-row preimage",()=>{
 it("authenticates the original absolute segment and separate fullPG domains",()=>{expect(verifiedAtomicCreditReservation(receipt(),[key])).toBe(true);});
 it("refuses changed root, parent physical row or original cap under the old MAC",()=>{const row=receipt();expect(verifiedAtomicCreditReservation({...row,parentFingerprint:"b".repeat(64)},[key])).toBe(false);expect(verifiedAtomicCreditReservation({...row,rootFundingId:paymentId},[key])).toBe(false);expect(verifiedAtomicCreditReservation({...row,economics:{...row.economics,segments:row.economics.segments.map(segment=>({...segment,epochAssignedFeeMinor:398}))}},[key])).toBe(false);});
 it("rejects even newly signed unexplained assigned400 for actual capped399",()=>{const row=receipt(),body={...row,economics:{...row.economics,assignedFeeMinor:400,nominalFeeMinor:400,retiredFeeMinor:0}};expect(verifiedAtomicCreditReservation({...body,...signAtomicCreditReservation(body,key)},[key])).toBe(false);});
 it("requires beforeEntries to predate this exact parent and child",()=>{const row=receipt();for(const table of ["invoice_credit_reservations","invoice_credit_reservation_atomic_fee_partitions"]){const body={...row,beforeEntries:[...row.beforeEntries,{key:`${table}:${row.reservationId}`,postgres_row:sha}]};expect(verifiedAtomicCreditReservation({...body,...signAtomicCreditReservation(body,key)},[key])).toBe(false);}});
 it("rejects duplicate/active-and-released predecessor identities and foreign key",()=>{const row=receipt(),body={...row,economics:{...row.economics,activeReservationIds:[paymentId],releasedReservationIds:[paymentId]}};expect(verifiedAtomicCreditReservation({...body,...signAtomicCreditReservation(body,key)},[key])).toBe(false);expect(verifiedAtomicCreditReservation(row,["foreign-key"])).toBe(false);});
});
