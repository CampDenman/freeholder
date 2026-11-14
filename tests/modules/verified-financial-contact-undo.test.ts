// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Real factory, bank, writer, paid effect and identity services.
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { prepareServiceJobRuntime, stopJobs } from "@/core/jobs";
import { getService } from "@/core/service";
import { contactReferences, createContact, mergeContacts, undoContactMerge } from "@/core/contacts/service";
import { contactMergeOperations } from "@/core/contacts/schema";
import { entitlementGrants } from "@/core/entitlements/schema";
import { carts } from "@/modules/catalog/schema";
import { inspectControlledCashReceipt } from "@/modules/invoicing/controlled-cash-inspection-service";
import { merchantCashReturnObservations } from "@/modules/invoicing/merchant-refund-schema";
import { merchantReturnedCashEvidenceSchema } from "@/modules/invoicing/merchant-returned-cash-contract";
import { collectControlledCollection } from "@/modules/subscriptions/controlled-provider-collection-orchestration";
import { CONTROLLED_COLLECTION_PROTOCOL } from "@/modules/subscriptions/controlled-provider-collection-protocol";
import { completePaidControlledPeriod } from "@/modules/subscriptions/controlled-provider-paid-period";
import { subscriptionOriginalEvidence } from "@/modules/subscriptions/merchant-scope";
import { onInvoicePaid } from "@/modules/subscriptions/service";
import { subscriptionProviderChargeReceipts, subscriptions } from "@/modules/subscriptions/schema";
import { actualCartlessControlledPeriod84 } from "../helpers/actual-cartless-controlled-period84";
import { retainActualControlledManifest84 } from "../helpers/actual-controlled-current-manifest84";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

/** Every actual public table, including audits and the merge operation. Raw
 * queries run in one genuine read transaction, without fabricated contexts. */
async function fullRows() {
 return db().transaction(async tx => {
  const tables = await tx.execute<{name: string}>(sql`select tablename as name from pg_tables where schemaname='public' order by tablename`);
  const rows: Array<{table: string; count: number; fingerprint: string}> = [];
  for (const table of tables) {
   const [row] = await tx.execute<{count: number; fingerprint: string}>(sql`select count(*)::integer as count,
    encode(sha256(convert_to(coalesce(string_agg(to_jsonb(actual_row)::text,E'\n' order by to_jsonb(actual_row)::text),''),'UTF8')),'hex') as fingerprint
    from ${sql.identifier("public")}.${sql.identifier(table.name)} actual_row`);
   if (!row) throw Error("Retain the entire actual public-table rollback inventory.");
   rows.push({table: table.name,...row});
  }
  return rows;
 });
}

describe.runIf(hasDatabase)("verified financial contact undo", {timeout: 180000}, () => {
 let f: Awaited<ReturnType<typeof actualCartlessControlledPeriod84>> | undefined;
 beforeAll(ready, 60000); beforeEach(truncateSpine);
 afterEach(() => { f?.cleanup(); f=undefined; vi.restoreAllMocks(); });
 afterAll(async () => { await stopJobs(); await closeDb(); });
 async function mergedPaid() {
  f=await actualCartlessControlledPeriod84();
  expect(await collectControlledCollection.call({collectionId:f.target.collectionId},OWNER)).toMatchObject({state:"money_retained",applied:false});
  await retainActualControlledManifest84(f);
  const receipts=await db().select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId,f.parent.id));
  expect(receipts).toHaveLength(1); const receipt=receipts[0]; if(!receipt)throw Error("Retain the real original receipt.");
  expect(await inspectControlledCashReceipt.call({collectionId:f.target.collectionId,receiptId:receipt.id},OWNER)).toMatchObject({bankReadReturned:true});
  const writer=getService("invoicing.applyControlledReceiptBatch");
  const money=z.object({invoiceId:z.uuid(),outstandingMinor:z.literal(0)}).passthrough().parse(await writer.call({collectionId:f.target.collectionId,receiptIds:[receipt.id],requiredProtocol:CONTROLLED_COLLECTION_PROTOCOL},{kind:"system"}));
  await onInvoicePaid({invoiceId:money.invoiceId});
  const effect=await completePaidControlledPeriod.call({invoiceId:money.invoiceId},{kind:"system"});
  expect(effect.handled).toBe(true);expect(["applied","already_applied"]).toContain(effect.state);
  const survivor=await createContact.call({name:"Verified paid survivor",email:"verified-undo-survivor@example.test"},OWNER);
  expect(await db().select().from(carts).where(eq(carts.contactId,f.parent.contactId))).toEqual([]);
  expect(await db().select().from(carts).where(eq(carts.contactId,survivor.id))).toEqual([]);
  const merged=await mergeContacts.call({survivingId:survivor.id,duplicateId:f.parent.contactId},OWNER);
  await stopJobs();
  // Mutation admission prepares the real producer before its business TX.
  // Finish those durable runtime births before the entire-table rollback oracle.
  await prepareServiceJobRuntime();
  return {fixture:f,receipt,survivor,merged};
 }
 it("verifies the clean complete merged graph before inverse writes and restores actual ownership",async()=>{
  const {fixture,survivor,merged}=await mergedPaid();
  const before=await db().transaction(tx=>subscriptionOriginalEvidence(tx,[fixture.parent.contactId,survivor.id]));
  expect(before.overflow).toBe(false);expect(before.evidence.length).toBeGreaterThan(0);
  const grants=await db().select().from(entitlementGrants).where(eq(entitlementGrants.sourceSubscriptionId,fixture.parent.id)).orderBy(entitlementGrants.id);
  await undoContactMerge.call({operationId:merged.mergeOperationId},OWNER);
  expect((await db().select().from(subscriptions).where(eq(subscriptions.id,fixture.parent.id)))[0]?.contactId).toBe(fixture.parent.contactId);
  const after=await db().select().from(entitlementGrants).where(eq(entitlementGrants.sourceSubscriptionId,fixture.parent.id)).orderBy(entitlementGrants.id);
  expect(after.map(({contactId:_contact,updatedAt:_updated,...row})=>row)).toEqual(grants.map(({contactId:_contact,updatedAt:_updated,...row})=>row));
  expect(after.every(row=>row.contactId===fixture.parent.contactId)).toBe(true);
  expect((await db().select().from(contactMergeOperations).where(eq(contactMergeOperations.id,merged.mergeOperationId)))[0]?.undoneAt).not.toBeNull();
 });
 it("refuses a genuine later financial read without altering any actual public-table row",async()=>{
  const {fixture,merged}=await mergedPaid();
  await retainActualControlledManifest84(fixture);
  const before=await fullRows();
  expect((await failure(undoContactMerge.call({operationId:merged.mergeOperationId},OWNER))).code).toBe("conflict");
  expect(await fullRows()).toEqual(before);
 });
 it("retains a real newer bank refund occurrence and refuses undo without dropping financial snapshots",async()=>{
  const {fixture,receipt,merged}=await mergedPaid();
  fixture.remote.externallyRefundPayment(receipt.providerPaymentIntentRef,1);
  const read=await inspectControlledCashReceipt.call({collectionId:fixture.target.collectionId,receiptId:receipt.id},OWNER);
  expect(read.bankReadReturned).toBe(true);
  const states=await db().select().from(merchantCashReturnObservations).where(eq(merchantCashReturnObservations.inspectionId,read.inspectionId)).orderBy(merchantCashReturnObservations.sequence);
  expect(merchantReturnedCashEvidenceSchema.parse(states.at(-1)?.evidence).refunds).toMatchObject([{amountMinor:1,status:"succeeded"}]);
  const before=await fullRows();
  expect((await failure(undoContactMerge.call({operationId:merged.mergeOperationId},OWNER))).code).toBe("conflict");
  expect(await fullRows()).toEqual(before);
 });
 it("rolls back contacts, financial inverses and actual grant writes when a later genuine inverse fails",async()=>{
  const {merged}=await mergedPaid();
  const reference=contactReferences().find(row=>row.table==="entitlement_grants");
  if(!reference)throw Error("Use the actual registered grant inverse.");
  const original=reference.restoreAfterUndo;
  const inverse=vi.spyOn(reference,"restoreAfterUndo").mockImplementation(async(...args)=>{await original(...args);throw Error("actual inverse failure after grant writes");});
  const before=await fullRows();
  await expect(undoContactMerge.call({operationId:merged.mergeOperationId},OWNER)).rejects.toThrow("actual inverse failure after grant writes");
  expect(inverse).toHaveBeenCalledOnce();
  expect(await fullRows()).toEqual(before);
 });
});
