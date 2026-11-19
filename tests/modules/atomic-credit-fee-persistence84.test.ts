// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Desired real full-spine B birth and deferred rollback controls.
import {eq,sql} from "drizzle-orm";
import {z} from "zod";
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {db} from "@/core/db";
import {defineService} from "@/core/service";
import {ready} from "@/core/runtime";
import {stopJobs} from "@/core/jobs";
import {entitlementGrants} from "@/core/entitlements/schema";
import {creditNotes,invoices,payments} from "@/modules/invoicing/schema";
import {invoiceCreditFunding,invoiceCreditReservations,invoiceCreditApplications} from "@/modules/invoicing/credit-application-schema";
import {invoiceCreditFundingAtomicFeePartitions} from "@/modules/invoicing/atomic-credit-fee-partition-schema";
import {invoiceCreditReservationAtomicFeePartitions} from "@/modules/invoicing/atomic-credit-reservation-schema";
import {subscriptionControlledQuotes} from "@/modules/subscriptions/controlled-provider-collection-schema";
import {subscriptionProrations} from "@/modules/subscriptions/proration-schema";
import {subscriptions} from "@/modules/subscriptions/schema";
import {acceptControlledProration} from "@/modules/subscriptions/controlled-provider-proration-acceptance";
import {verifiedAtomicCreditFeeDeclaration} from "@/modules/invoicing/atomic-credit-fee-declaration-proof";
import {verifiedAtomicCreditFeePartition} from "@/modules/invoicing/atomic-credit-fee-partition-proof";
import {verifiedAtomicCreditReservation} from "@/modules/invoicing/atomic-credit-reservation-proof";
import {originalCashEvidenceKeys} from "@/modules/invoicing/original-cash-evidence-keys";
import * as partitionRetainer from "@/modules/invoicing/atomic-credit-fee-partition-retain";
import {atomicCreditFeePartitionWitnesses,exportAtomicCreditFeePartitionHistory} from "@/modules/invoicing/atomic-credit-fee-financial";
import {controlledFinancialWitness} from "@/modules/invoicing/controlled-provider-financial-witness";
import {actualControlledPeriod84} from "../helpers/actual-controlled-period84";
import {actualAtomicCreditSource84} from "../helpers/actual-atomic-credit-source84";
import {closeDb,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";
const system={kind:"system"} as const;
const caughtAcceptance=defineService({name:"subscriptions.testCaughtAtomicCreditPurposeBirth",summary:"Try a real acceptance and catch only the deliberate child-writer fault; deferred SQL still must refuse commit.",kind:"mutation",permission:"system",external:false,
 input:acceptControlledProration.def.input,output:z.literal(true),handler:async(input,ctx)=>{try{await ctx.callAsSystem(acceptControlledProration,input);}catch(error){if(!(error instanceof Error)||error.message!=="Deliberate B purpose writer refusal")throw error;}return true as const;}});
const footprint=defineService({name:"invoicing.testAtomicCreditPurposeFootprint",summary:"Read real exact-owner PG witnesses and safe projections through the actual current financial adapter.",kind:"query",permission:"system",external:false,input:z.object({fundingIds:z.array(z.uuid()),invoiceId:z.uuid()}).strict(),output:z.object({identities:z.array(z.string()),central:z.array(z.string()),buyer:z.unknown(),merchant:z.unknown(),exact:z.boolean()}),handler:async(input,ctx)=>{
 const selected=await atomicCreditFeePartitionWitnesses(ctx.tx,{fundingIds:input.fundingIds}),entry=selected.entries[0];if(!entry)throw Error("Retain a genuine actual purpose first.");
 const central=await controlledFinancialWitness(ctx.tx,{invoiceIds:[input.invoiceId]});if(central.incomplete)throw Error("Restore complete actual central ownership.");
 const buyer=await exportAtomicCreditFeePartitionHistory(ctx.tx,{fundingIds:input.fundingIds},{merchant:false,existingIdentities:central.entries.map(row=>`${row.table}:${row.id}`)});
 const merchant=await exportAtomicCreditFeePartitionHistory(ctx.tx,{fundingIds:input.fundingIds,profileId:entry.parents.profileId},{merchant:true,existingIdentities:central.entries.map(row=>`${row.table}:${row.id}`)});
 const rows=await ctx.tx.execute<{id:string;fingerprint:string}>(sql`select purpose.funding_id::text as id,encode(sha256(convert_to(to_jsonb(purpose)::text,'UTF8')),'hex') as fingerprint from invoice_credit_funding_atomic_fee_partitions purpose where purpose.funding_id in(${sql.join(input.fundingIds.map(id=>sql`${id}::uuid`),sql`,`)})`);
 return{identities:selected.entries.map(row=>`${row.table}:${row.id}`),central:central.entries.map(row=>`${row.table}:${row.id}`),buyer:buyer.exported,merchant:merchant.exported,exact:rows.every(row=>selected.entries.some(actual=>actual.table==="invoice_credit_funding_atomic_fee_partitions"&&actual.id===row.id&&actual.fingerprint===row.fingerprint))};
}});
async function canonical(){return{invoices:await db().select().from(invoices).orderBy(invoices.id),cash:await db().select().from(payments).orderBy(payments.id),notes:await db().select().from(creditNotes).orderBy(creditNotes.id),prorations:await db().select().from(subscriptionProrations).orderBy(subscriptionProrations.id),parents:await db().select().from(subscriptions).orderBy(subscriptions.id),grants:await db().select().from(entitlementGrants).orderBy(entitlementGrants.id),funding:await db().select().from(invoiceCreditFunding).orderBy(invoiceCreditFunding.id),reservations:await db().select().from(invoiceCreditReservations).orderBy(invoiceCreditReservations.id),applications:await db().select().from(invoiceCreditApplications).orderBy(invoiceCreditApplications.reservationId),fundingPurposes:await db().select().from(invoiceCreditFundingAtomicFeePartitions).orderBy(invoiceCreditFundingAtomicFeePartitions.fundingId),reservationPurposes:await db().select().from(invoiceCreditReservationAtomicFeePartitions).orderBy(invoiceCreditReservationAtomicFeePartitions.reservationId)};}
// DEADLINE RAISED 180s -> 300s on 2026-11-19, by Tony's explicit decision, and
// this file is now the one money suite that departs from the 180s convention
// the other ten keep. Recorded here because the number alone does not say what
// was traded.
//
// The 180s was never a product promise. MASTER.md records six real cases
// passing against it at 135.24-173.87s, so it sat about six seconds above the
// worst real case and worked as a regression tripwire: a 4% slowdown tripped
// it. What broke was not the payment path but where it runs -- measured
// 2026-11-19, this file costs ~134s here and ~241s on a GitHub-hosted runner,
// which is 1.8x slower. Nothing regressed; the ceiling simply sat under the
// cost on that hardware.
//
// 300s keeps ~24% headroom over the measured 241s. The price is detection: at
// 300s this suite no longer catches anything smaller than a ~2x regression,
// where it used to catch 4%. The per-service cost is reported on every run by
// atomic-credit-stage-profile89, whose header carries the attribution, so the
// cost stays visible even though this ceiling no longer polices it.
//
// Raising it meant re-anchoring TWELVE live pins across eight records, two of
// them freezes (atomic-credit-fee-partition84.freeze.json and the
// frozen.sha256 in atomic-credit-fee-root-assembly-20261114.json). That file
// was frozen deliberately; unfreezing it was authorised, not incidental. If
// the payment path is ever made fast enough to fit 180s at 1.8x -- under about
// 100s here -- put this back and re-freeze it.
describe.runIf(hasDatabase)("actual B same-transaction original fee-epoch persistence",{timeout:300000},()=>{
 let f:Awaited<ReturnType<typeof actualControlledPeriod84>>|undefined;
 beforeAll(ready,60000);beforeEach(truncateSpine);afterEach(()=>{vi.useRealTimers();f?.cleanup();f=undefined;vi.restoreAllMocks();});afterAll(async()=>{await stopJobs();await closeDb();});
 it("uses the original400/4199 epoch after an authentic sibling return and fee1, with actual signed purpose parents, safe archives and full-PG central footprints",async()=>{
  f=await actualControlledPeriod84({prorationPreview6000:true});const source=await actualAtomicCreditSource84(f),[quote]=await db().select().from(subscriptionControlledQuotes).where(eq(subscriptionControlledQuotes.id,source.review.controlled.quoteId));
  if(!quote?.review)throw Error("Retain the real stored private review.");
  expect(verifiedAtomicCreditFeeDeclaration(Reflect.get(quote.review,"atomicCreditFeeDeclaration"),quote.createdAt,originalCashEvidenceKeys())).toBe(true);
  expect(JSON.stringify(source.review)).not.toContain("atomicCreditFeeDeclaration");
  const cashBefore=await db().select().from(payments).orderBy(payments.id),accepted=await acceptControlledProration.call(source.input,OWNER);
  const funds=await db().select().from(invoiceCreditFunding).where(eq(invoiceCreditFunding.prorationId,accepted.prorationId));expect(funds.length).toBeGreaterThan(0);
  const purposes=await db().select().from(invoiceCreditFundingAtomicFeePartitions);expect(purposes).toHaveLength(funds.length);
  for(const row of purposes){const parent=funds.find(funding=>funding.id===row.fundingId);if(!parent)throw Error("An actual funding FK must own each purpose.");
   expect(row.sourcePaymentId).toBe(source.big.id);expect(row.sourcePaymentId).not.toBe(source.tiny.id);expect(verifiedAtomicCreditFeePartition(row,originalCashEvidenceKeys())).toBe(true);
   expect(row.economics.plan).toMatchObject({originalPrincipalMinor:4199,originalFeeMinor:400,originalPaymentFeeMinor:400,originalResourceRetiredFeeMinor:1,actualCollectedFeeMinor:399,takePrincipalMinor:parent.amountMinor});
   const nominal=Number(400n*BigInt(parent.amountMinor)/4199n);expect(parent.feeObligationMinor).toBe(Math.min(nominal,399));expect(row.economics.plan.takeRetiredFeeMinor).toBe(nominal-parent.feeObligationMinor);
  }
  const reservations=await db().select().from(invoiceCreditReservations),reservationPurposes=await db().select().from(invoiceCreditReservationAtomicFeePartitions);expect(reservationPurposes).toHaveLength(reservations.length);
  for(const row of reservationPurposes){expect(verifiedAtomicCreditReservation(row,originalCashEvidenceKeys())).toBe(true);expect(reservations.some(parent=>parent.id===row.reservationId&&parent.fundingId===row.fundingId)).toBe(true);}
  const result=await footprint.call({fundingIds:funds.map(row=>row.id),invoiceId:f.target.invoiceId},system);expect(result.exact).toBe(true);expect(new Set(result.central).size).toBe(result.central.length);for(const id of result.identities)expect(result.central).toContain(id);
  for(const projection of [result.buyer,result.merchant]){const text=JSON.stringify(projection);for(const name of ["beforeEntries","authentication","admissionTransactionId","bankNamespaceRevision","postgresSourceRevision","birthDeclaration"])expect(text).not.toContain(`\"${name}\"`);}
  expect(await db().select().from(payments).orderBy(payments.id)).toEqual(cashBefore);
  for(const purpose of purposes)await expect(db().delete(invoiceCreditFundingAtomicFeePartitions).where(eq(invoiceCreditFundingAtomicFeePartitions.fundingId,purpose.fundingId))).rejects.toThrow();
 });
 it("rolls back complete real canonical acceptance after an actual child-writer fault even if the outer service catches it",async()=>{
  f=await actualControlledPeriod84({prorationPreview6000:true});const source=await actualAtomicCreditSource84(f),before=await canonical();let actualParentId:string|undefined;
  const fault=vi.spyOn(partitionRetainer,"retainAtomicCreditFundingPartition").mockImplementationOnce(async(ctx,input)=>{const[parent]=await ctx.tx.select().from(invoiceCreditFunding).where(eq(invoiceCreditFunding.id,input.fundingId));if(!parent)throw Error("The genuine parent must already exist before this deliberate fault.");actualParentId=parent.id;throw Error("Deliberate B purpose writer refusal");});
  await expect(caughtAcceptance.call(source.input,system)).rejects.toThrow();expect(actualParentId).toBeDefined();fault.mockRestore();expect(await canonical()).toEqual(before);
  expect((await db().select().from(subscriptionControlledQuotes).where(eq(subscriptionControlledQuotes.id,source.review.controlled.quoteId)))[0]).toBeDefined();
 });
 it("executes the genuine queued B deferred birth check against its actual newborn parent before any child exists",async()=>{
  f=await actualControlledPeriod84({prorationPreview6000:true});const source=await actualAtomicCreditSource84(f),before=await canonical();let actualParentId:string|undefined;const messages:string[]=[];
  const fault=vi.spyOn(partitionRetainer,"retainAtomicCreditFundingPartition").mockImplementationOnce(async(ctx,input)=>{
   const[parent]=await ctx.tx.select().from(invoiceCreditFunding).where(eq(invoiceCreditFunding.id,input.fundingId));if(!parent)throw Error("Exercise the actual parent birth, not a synthetic trigger context.");actualParentId=parent.id;
   // Stronger validation only: fire this genuine queued constraint event now,
   // leaving every other guard/default intact. The real default remains
   // INITIALLY DEFERRED and the positive case must pass at actual commit.
   try{await ctx.tx.execute(sql`set constraints credit_atomic_fee_funding_birth immediate`);}catch(error){let current:unknown=error;const seen=new Set<unknown>();while(current instanceof Error&&!seen.has(current)){seen.add(current);messages.push(current.message);current=Reflect.get(current,"cause");}throw error;}
   throw Error("The genuine missing-purpose constraint unexpectedly allowed its actual parent.");
  });
  await expect(acceptControlledProration.call(source.input,OWNER)).rejects.toThrow();fault.mockRestore();expect(actualParentId).toBeDefined();expect(messages.join("\n")).toContain("Every genuine atomic-retired funding requires its actual same-transaction purpose");expect(await canonical()).toEqual(before);
 });
});
