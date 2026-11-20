// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: immutable provider pages, never current-key birth backfill.
import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type { TransferInventoryConfiguration, TransferInventoryPage, TransferRevision } from "../../../scripts/media-transfer.mjs";
import type { Actor, Tx } from "@/core/service";
import { env } from "@/core/env";
import { mediaStorageTransferCalls, mediaStorageTransferObjects, mediaStorageTransferReceipts } from "./transfer-schema";
import { mediaStorageTransferRequests, mediaStorageTransferRequestObservations } from "./transfer-request-schema";
import { mediaStorageProviderInventories as inventories, mediaStorageProviderInventoryPages as pages, mediaStorageProviderInventoryEntries as entries } from "./transfer-inventory-schema";
import { assertTransferCallDrain, assertTransferOwners, lockedTransfer } from "./transfer-authority";
import { transferConflict, transferDigest } from "./transfer-proof";
import { objectKeyDigest } from "./write-ledger";
import { classifySourceInventory, currentProviderObjects, inventoryResourceDigest, originalResourceAbsent, physicalInventoryBytes, providerInventoryDigest, requireCompletePages, sameProviderRevision } from "./transfer-inventory-proof";
import { transferRequestsDrained } from "./transfer-requests";

type Inventory = typeof inventories.$inferSelect;
export interface ProviderInventoryCapture { planId: string; side: "source" | "target"; purpose: "baseline" | "retirement" | "erasure"; objectId?: string; anchorCallId?: string }
const expectedKind = (row: Pick<Inventory, "side" | "purpose">) => row.purpose === "baseline" ? row.side === "source" ? "source_inventory" : "target_inventory" : row.purpose === "retirement" ? "source_retirement_inventory" : row.side === "source" ? "source_erasure_inventory" : "target_erasure_inventory";
function kinds(row: Inventory) { return row.binding.kind === "s3" ? ["objects", "versions", "sessions"] as const : ["objects", "versions", "retained"] as const; }
const wireDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function lockedInventory(tx: Tx, id: string, actor: Actor) {
  const [identity] = await tx.select({ planId: inventories.planId }).from(inventories).where(eq(inventories.id, id)).limit(1);
  if (!identity?.planId) transferConflict("The original transfer provider inventory header is missing.");
  const work = await lockedTransfer(tx, identity.planId);
  const [inventory] = await tx.select().from(inventories).where(eq(inventories.id, id)).limit(1).for("update");
  if (!inventory || inventory.namespace !== (inventory.side === "source" ? work.plan.sourceNamespace : work.plan.targetNamespace)) transferConflict();
  const privacy = inventory.purpose === "erasure";
  if (privacy && actor.kind !== "system") transferConflict("Original erasure inventory requires its real owning service authority.");
  await assertTransferOwners(tx, privacy ? work.objects.filter(row => row.id === inventory.objectId) : work.objects, privacy);
  await assertTransferCallDrain(tx, work.objects.map(row => row.id));
  return { ...work, inventory };
}
export async function captureProviderInventory(tx: Tx, input: ProviderInventoryCapture, actor: Actor) {
  const work = await lockedTransfer(tx, input.planId), object = input.objectId ? work.objects.find(row => row.id === input.objectId) : work.objects[0];
  if (!object || input.purpose !== "baseline" && (!input.objectId || !input.anchorCallId) || input.purpose === "baseline" && (input.objectId || input.anchorCallId) || input.purpose === "retirement" && input.side !== "source") transferConflict();
  const privacy = input.purpose === "erasure";
  if (privacy && actor.kind !== "system") transferConflict();
  await assertTransferOwners(tx, privacy ? [object] : work.objects, privacy);
  await assertTransferCallDrain(tx, work.objects.map(row => row.id));
  if (input.anchorCallId) {
    const [anchor] = await tx.select().from(mediaStorageTransferCalls).where(eq(mediaStorageTransferCalls.id, input.anchorCallId)).limit(1);
    if (!anchor || anchor.objectId !== object.id || anchor.state !== "returned" || !anchor.returnedAt || anchor.namespace !== (input.side === "source" ? work.plan.sourceNamespace : work.plan.targetNamespace)) transferConflict("Physical retirement inventory must follow its exact actual original returned caller.");
  }
  const prior = await tx.select().from(inventories).where(and(eq(inventories.planId, input.planId), eq(inventories.side, input.side), eq(inventories.purpose, input.purpose), input.anchorCallId ? eq(inventories.anchorCallId, input.anchorCallId) : undefined)).limit(1).for("update");
  if (prior[0]) return prior[0];
  const binding = input.side === "source" ? work.plan.originalSource : work.plan.originalTarget;
  const [header] = await tx.insert(inventories).values({ id: randomUUID(), planId: work.plan.id, objectId: input.objectId ?? null, anchorCallId: input.anchorCallId ?? null, side: input.side, purpose: input.purpose, binding, namespace: binding.namespace, state: "capturing" }).returning();
  return header!;
}
export async function providerInventoryProgress(tx: Tx, id: string, actor: Actor) {
  const { inventory } = await lockedInventory(tx, id, actor);
  const capturedPages = await tx.select().from(pages).where(eq(pages.inventoryId, id)).orderBy(asc(pages.pass), asc(pages.createdAt), asc(pages.id));
  return { inventory, pages: capturedPages };
}
export interface ProviderInventoryPageResult { inventoryId: string; callId: string; pass: 0 | 1; kind: "configuration" | "objects" | "versions" | "sessions" | "retained"; cursor: Record<string, string> | null; page?: TransferInventoryPage; configuration?: TransferInventoryConfiguration }
export async function appendProviderInventoryPage(tx: Tx, input: ProviderInventoryPageResult, actor: Actor) {
  const { inventory, objects } = await lockedInventory(tx, input.inventoryId, actor);
  if (inventory.state !== "capturing" || input.pass !== 0 && input.pass !== 1 || input.kind !== "configuration" && !kinds(inventory).some(kind=>kind===input.kind)) transferConflict();
  const page = input.page, configuration = input.configuration;
  if (input.kind === "configuration" ? !configuration || page || input.cursor !== null : !page || configuration || page.entries.length > 250) transferConflict();
  const result = input.kind === "configuration" ? { configurationDigest: transferDigest(configuration) } : { inventoryDigest: transferDigest(page), inventoryCount: page!.entries.length };
  const [call] = await tx.select().from(mediaStorageTransferCalls).where(eq(mediaStorageTransferCalls.id, input.callId)).limit(1);
  const representative = inventory.objectId ?? objects[0]!.id;
  if (!call || call.objectId !== representative || call.kind !== expectedKind(inventory) || call.namespace !== inventory.namespace || call.state !== "returned" || !call.returnedAt || call.resultDigest !== transferDigest(result) || !await transferRequestsDrained(tx, [call.id])) transferConflict("Only an exact actual finished original provider result can append an inventory page.");
  const actual = await tx.select({ request: mediaStorageTransferRequests, fact: mediaStorageTransferRequestObservations }).from(mediaStorageTransferRequests).innerJoin(mediaStorageTransferRequestObservations, eq(mediaStorageTransferRequestObservations.requestId, mediaStorageTransferRequests.id)).where(and(eq(mediaStorageTransferRequests.callId, call.id), eq(mediaStorageTransferRequests.state, "returned")));
  const physicalKind = input.kind === "configuration" ? "bucket.metadata" : `inventory.${input.kind}`;
  if (!actual.some(row => row.request.descriptor.kind === physicalKind && transferDigest(row.request.descriptor.binding) === transferDigest(inventory.binding) && row.fact.facts.stage === (configuration ? "configuration" : "inventory") && row.fact.facts.detailDigest === wireDigest(configuration ?? page))) transferConflict("The page has no intact actual original provider observation.");
  const captured = await tx.select().from(pages).where(and(eq(pages.inventoryId, inventory.id), eq(pages.pass, input.pass), eq(pages.kind, input.kind))).orderBy(asc(pages.createdAt), asc(pages.id));
  if (input.kind === "configuration" ? captured.length > 0 : captured.length ? captured.at(-1)!.nextCursor === null || transferDigest(input.cursor) !== transferDigest(captured.at(-1)!.nextCursor) : input.cursor !== null) transferConflict("The original provider page chain cannot be overwritten or rebound.");
  if (input.pass === 1 && !(await tx.select().from(pages).where(and(eq(pages.inventoryId, inventory.id), eq(pages.pass, 0), eq(pages.kind, "configuration"))).limit(1)).length) transferConflict();
  const [saved] = await tx.insert(pages).values({ inventoryId: inventory.id, callId: call.id, pass: input.pass, kind: input.kind, cursor: input.cursor, cursorDigest: transferDigest(input.cursor), nextCursor: page?.next ?? null, pageDigest: transferDigest(configuration ?? page), membershipDigest:transferDigest(page?.entries.map(entry=>transferDigest(entry))??[]),entryCount: page?.entries.length ?? 0, configuration }).returning();
  if (page?.entries.length) await tx.insert(entries).values(page.entries.map((entry,ordinal) => ({ ordinal,entryDigest:transferDigest(entry),inventoryId: inventory.id, pageId: saved!.id, pass: input.pass, entry, keyDigest: objectKeyDigest(entry.key), resourceDigest: inventoryResourceDigest(entry), attribution: inventory.side === "target" && inventory.purpose === "baseline" ? "preexisting_target" as const : "unattributed" as const })));
  return { ok: true as const };
}
export async function readProviderInventoryPass(tx: Tx, inventory: Inventory, pass: 0 | 1) {
  const saved = await tx.select().from(pages).where(and(eq(pages.inventoryId, inventory.id), eq(pages.pass, pass))).orderBy(asc(pages.createdAt), asc(pages.id));
  const config = saved.filter(row => row.kind === "configuration");
  if (config.length !== 1 || !config[0]!.configuration) transferConflict("The original provider policy page is incomplete.");
  const observed = await tx.select().from(entries).where(and(eq(entries.inventoryId, inventory.id), eq(entries.pass, pass))).orderBy(asc(entries.ordinal)).limit(50001);
  if (observed.length > 50000) transferConflict("The complete physical inventory exceeds this bounded proof; no subset can be adopted.");
  for (const kind of kinds(inventory)) {
    const chain = saved.filter(row => row.kind === kind);
    requireCompletePages(chain.map(row => ({ cursor: row.cursor, next: row.nextCursor, page: { entries: observed.filter(entry => entry.pageId === row.id).map(entry => entry.entry), next: row.nextCursor } })));
    for (const row of chain) { const full = { entries: observed.filter(entry => entry.pageId === row.id).map(entry => entry.entry), next: row.nextCursor }; if (row.entryCount !== full.entries.length || row.pageDigest !== transferDigest(full) || row.membershipDigest!==transferDigest(observed.filter(entry=>entry.pageId===row.id).map(entry=>entry.entryDigest)) || observed.filter(entry=>entry.pageId===row.id).some(entry=>entry.redactedAt||entry.entryDigest!==transferDigest(entry.entry))) transferConflict("Restore the intact original physical inventory page."); }
  }
  return { configuration: config[0]!.configuration, entries: observed.map(row => row.entry) };
}
export async function finishProviderInventory(tx: Tx, id: string, actor: Actor) {
  const { inventory, objects } = await lockedInventory(tx, id, actor);
  if (inventory.state !== "capturing") return inventory;
  const first = await readProviderInventoryPass(tx, inventory, 0), confirmed = await readProviderInventoryPass(tx, inventory, 1);
  const firstDigest = providerInventoryDigest(first.configuration, first.entries), confirmedDigest = providerInventoryDigest(confirmed.configuration, confirmed.entries);
  const provenOriginals:Array<{id:string;key:string;revision:TransferRevision}>=[];
  let blocker: string | null = firstDigest !== confirmedDigest ? "provider_inventory_changed" : null;
  if (!blocker && inventory.purpose === "baseline" && inventory.side === "source") {
    const originals = [];
    for (const object of objects) {
      const receipts = await tx.select().from(mediaStorageTransferReceipts).where(eq(mediaStorageTransferReceipts.objectId, object.id));
      if(receipts.some(row=>transferDigest(row.originalSnapshot)!==row.originalSnapshotDigest))transferConflict("Restore the intact immutable original provider receipt capture.");
      const live = receipts.map(row => row.originalSnapshot).filter(row => row.operation === "put" && row.state === "accepted" && !row.deletedAt);
      const revisions = live.map(row => row.providerRevision as TransferRevision | undefined);
      if (!revisions.length || live.some((row,index)=>!row.writerRuntimeId||!row.writerFinishedAt||row.providerRevisionDigest!==transferDigest(revisions[index])) || revisions.some(value => !value || !sameProviderRevision(value, revisions[0], first.configuration))) { blocker = "missing_original_provider_result"; break; }
      originals.push({ ...object, originalRevision: revisions[0] });
      provenOriginals.push({id:object.id,key:object.key,revision:revisions[0]!});
    }
    if (!blocker) { const classified = classifySourceInventory(first.configuration, first.entries, originals, inventory.namespace); if (!classified.complete) blocker = classified.reason; }
  } else if (!blocker && inventory.purpose !== "baseline") {
    const object = objects.find(row => row.id === inventory.objectId); if (!object) transferConflict();
    const key = inventory.side === "source" ? object.key : object.targetKey;
    if (!originalResourceAbsent(first.entries, key) || !originalResourceAbsent(confirmed.entries, key)) blocker = "original_physical_version_or_session_remains";
  } else if (!blocker && first.entries.some(row => row.kind === "session")) blocker = "unattributed_target_upload_session";
  const bytes = physicalInventoryBytes(first.configuration, first.entries);
  if (!blocker && inventory.side === "target" && inventory.purpose === "baseline" && env().MEDIA_TRANSFER_TARGET_QUOTA_BYTES) {
    const quota = await tx.execute<{ used: string }>(sql`select coalesce(sum(bytes),0)::text as used from storage_quota_objects where namespace=${inventory.namespace}`);
    if (BigInt(quota[0]?.used ?? "-1") !== BigInt(bytes)) blocker = "destination_quota_inventory_mismatch";
  }
  if(!blocker&&inventory.side==="source"&&inventory.purpose==="baseline"){
    const observed=await tx.select().from(entries).where(eq(entries.inventoryId,id));
    for(const leaf of observed){const original=provenOriginals.find(row=>row.key===leaf.entry.key&&transferDigest(row.revision)===transferDigest(leaf.entry.revision));if(original)await tx.update(entries).set({originalObjectId:original.id,attribution:"original_current"}).where(eq(entries.id,leaf.id));}
  }
  const [saved] = await tx.update(inventories).set({ firstDigest, confirmedDigest, configuration: first.configuration, entryCount: first.entries.length, totalBytes: bytes, state: blocker ? "blocked" : "complete", blocker, completedAt: blocker ? null : new Date(), updatedAt: new Date() }).where(eq(inventories.id, id)).returning();
  return saved!;
}
export async function requireOriginalProviderBaseline(tx: Tx, planId: string, objectId: string, actual?: TransferRevision) {
  const [header] = await tx.select().from(inventories).where(and(eq(inventories.planId, planId), eq(inventories.side, "source"), eq(inventories.purpose, "baseline"))).limit(1);
  const [target] = await tx.select().from(inventories).where(and(eq(inventories.planId, planId), eq(inventories.side, "target"), eq(inventories.purpose, "baseline"))).limit(1);
  if (header?.state !== "complete" || target?.state !== "complete") transferConflict("Both complete original provider inventories must be captured before copying or adoption.");
  const [object] = await tx.select().from(mediaStorageTransferObjects).where(eq(mediaStorageTransferObjects.id, objectId)).limit(1);
  if (!object || object.planId !== planId) transferConflict();
  if(!header.configuration)transferConflict();
  const observed=await tx.select().from(entries).where(and(eq(entries.inventoryId,header.id),eq(entries.pass,0),eq(entries.keyDigest,object.keyDigest)));
  if(observed.some(row=>row.redactedAt||transferDigest(row.entry)!==row.entryDigest))transferConflict("Restore the intact original inventory leaf for this exact still-live object.");
  const revision=currentProviderObjects(header.configuration,observed.map(row=>row.entry)).find(row=>row.key===object.key)?.revision;
  if (!revision || actual && !sameProviderRevision(revision, actual, header.configuration)) transferConflict("The actual source read differs from its original complete inventory.");
  return revision;
}
export async function requireCompletePhysicalRetirementInventory(tx: Tx, id: string, objectId: string, side: "source" | "target", anchorCallId: string) {
  const [header] = await tx.select().from(inventories).where(eq(inventories.id, id)).limit(1);
  if (!header || header.objectId !== objectId || header.side !== side || header.anchorCallId !== anchorCallId || header.state !== "complete" || header.purpose === "baseline") transferConflict("Every original physical version/session must be absent after its exact actual caller before retirement.");
  const [object] = await tx.select().from(mediaStorageTransferObjects).where(eq(mediaStorageTransferObjects.id, objectId)).limit(1); if (!object) transferConflict();
  const key = side === "source" ? object.key : object.targetKey;
  // Complete first proofs retain immutable key/resource/leaf digests after
  // scoped privacy minimization; unrelated raw entries need not be restored.
  const remaining=await tx.select({id:entries.id}).from(entries).where(and(eq(entries.inventoryId,header.id),eq(entries.keyDigest,objectKeyDigest(key)))).limit(1);
  if(remaining.length)transferConflict();
  return header;
}
