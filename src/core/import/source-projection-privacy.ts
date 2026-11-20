// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C3.47: reduce only captured unaccepted input after actual retirement.
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { importRuns, importSourceEntries, importSourceGraphs, importSourceMedia } from "@/core/plugins/schema";
import { auditLog } from "@/core/events/schema";
import { ServiceError, type Tx } from "@/core/service";
import { importSourceErasureMembers, importSourceErasureObjects } from "./source-erasure-schema";
import { originalSourceErasureScopeComplete, sourceObjectKey } from "./source-erasure-scope";
import { markImportGraphWriter } from "./graph-writer";

export const REDACTED_UPLOADED_ENTRY = Object.freeze({ format: "uploaded-originals", redacted: true });
export const REDACTED_UPLOADED_PLAN = Object.freeze({ redacted: true });

export async function originalUploadTaskMembers(tx: Tx, requestId: string, keys: string[]) {
  if (!await originalSourceErasureScopeComplete(tx, requestId)) throw new ServiceError("conflict", "Restore the complete original uploaded-source erasure scope before cleanup.");
  const members = new Map<string, typeof importSourceErasureMembers.$inferSelect>();
  for (const key of keys) {
    sourceObjectKey.parse(key);
    const [,runId,uploadId,part] = key.split("/"); const index = Number(part!.slice(0,5));
    const [row] = await tx.select({ member: importSourceErasureMembers }).from(importSourceErasureObjects).innerJoin(importSourceErasureMembers,
      and(eq(importSourceErasureMembers.requestId, importSourceErasureObjects.requestId),eq(importSourceErasureMembers.runId, importSourceErasureObjects.runId),eq(importSourceErasureMembers.uploadId, importSourceErasureObjects.uploadId)))
      .where(and(eq(importSourceErasureObjects.requestId, requestId),eq(importSourceErasureObjects.runId, runId!),eq(importSourceErasureObjects.uploadId, uploadId!),eq(importSourceErasureObjects.chunkIndex,index),eq(importSourceErasureObjects.keyDigest,createHash("sha256").update(key).digest("hex"))));
    if (!row) throw new ServiceError("conflict", "This actual task has no exact original uploaded-source membership.");
    members.set(`${runId}:${uploadId}`,row.member);
  }
  return [...members.values()].sort((a,b) => a.runId.localeCompare(b.runId)||a.uploadId.localeCompare(b.uploadId));
}

/** Admission checks precede physical I/O. A lease expiry, current rows or an
 * absent object never prove that accepted/unresolved media can be discarded. */
export async function assertOriginalUploadMinimizable(tx: Tx, requestId: string, keys: string[]): Promise<void> {
  const members = await originalUploadTaskMembers(tx,requestId,keys);
  for (const member of members) {
    await tx.select({ id: importRuns.id }).from(importRuns).where(eq(importRuns.id,member.runId)).for("update");
    const [held] = await tx.execute<{ held: boolean }>(sql`select freeholder_source_upload_held(${member.runId}::uuid,${member.uploadId}::uuid) held`);
    if (held?.held) throw new ServiceError("conflict", "The original uploaded generation is legally held or has unknown original hold membership.");
    if (!member.graphId) continue;
    const [graph] = await tx.select().from(importSourceGraphs).where(eq(importSourceGraphs.id,member.graphId)).for("update");
    const [blocked] = await tx.execute<{ blocked: boolean }>(sql`select exists(select 1 from import_source_media media where media.graph_id=${member.graphId}::uuid
      and (media.asset_id is not null or media.digest is not null or media.bytes is not null or media.source_key_digest is null))
      or exists(select 1 from import_source_batches batch where batch.graph_id=${member.graphId}::uuid)
      or exists(select 1 from import_source_entries entry where entry.graph_id=${member.graphId}::uuid and entry.target_page_id is not null) blocked`);
    if (!graph || graph.generation!==member.graphGeneration || graph.sourceRevision!==member.sourceRevision || graph.planDigest!==null || graph.leaseToken!==null || blocked?.blocked) {
      throw new ServiceError("conflict", "The original uploaded index has accepted or unresolved business ownership; review its recovery before cleanup.");
    }
  }
}

/** Current source rows may refuse recovery but cannot authorize attaching an
 * old job to a replacement upload or graph. The SQL predicate checks the exact
 * first-captured revision/generation, all original physical facts and holds. */
export async function minimizeOriginalUploadProjections(tx: Tx, requestId: string, keys: string[]): Promise<void> {
  const members = await originalUploadTaskMembers(tx,requestId,keys);
  await assertOriginalUploadMinimizable(tx,requestId,keys);
  await markImportGraphWriter(tx);
  await tx.execute(sql`select set_config('freeholder.import_source_projection_redaction',${requestId},true)`);
  for (const member of members) {
    if (!member.graphId) continue;
    const [ready] = await tx.execute<{ ready: boolean }>(sql`select freeholder_source_graph_projection_retired(${member.graphId}::uuid,${requestId}::uuid) ready`);
    // Another actual task may own the remaining original chunks. Its pending
    // ACK remains in the same receipt; the completion trigger checks all scope.
    if (!ready?.ready) continue;
    await tx.update(importSourceEntries).set({ metadata: REDACTED_UPLOADED_ENTRY,targetSlug:null }).where(eq(importSourceEntries.graphId,member.graphId));
    await tx.update(importSourceGraphs).set({ headerMetadata:REDACTED_UPLOADED_ENTRY,planMetadata:REDACTED_UPLOADED_PLAN,updatedAt:new Date() }).where(eq(importSourceGraphs.id,member.graphId));
    await tx.update(importSourceMedia).set({ key:sql`'redacted:'||${importSourceMedia.id}::text`,planned:REDACTED_UPLOADED_PLAN,error:null }).where(eq(importSourceMedia.graphId,member.graphId));
    const [root] = await tx.select().from(importRuns).where(eq(importRuns.id,member.runId));
    if (!root) throw new ServiceError("conflict", "Restore the original uploaded import receipt before completion.");
    const checkpoint = root.checkpoint && typeof root.checkpoint === "object" && !Array.isArray(root.checkpoint) ? {...root.checkpoint as Record<string,unknown>} : {};
    for (const field of ["readerSourceSite","origin","report","source","pendingBlogPosts"]) delete checkpoint[field];
    for (const field of ["sourceUpload","retainedSource"]) {
      const value=checkpoint[field];
      if(value && typeof value==="object" && !Array.isArray(value) && (value as Record<string,unknown>).uploadId===member.uploadId) checkpoint[field]={...value as Record<string,unknown>,filename:"redacted-source"};
    }
    await tx.update(importRuns).set({ origin:null,preview:{sourceFormat:"redacted-uploaded-input"},checkpoint,conflicts:[],error:"Original uploaded input was minimized for privacy; start a reviewed new import." }).where(eq(importRuns.id,member.runId));
    await tx.update(auditLog).set({diff:sql`${auditLog.diff}-'origin'-'url'-'payload'-'preview'-'pages'-'prefix'-'robotsTxt'-'report'`}).where(and(eq(auditLog.subjectType,"import_run"),eq(auditLog.subjectId,member.runId),sql`${auditLog.action} like 'imports.%'`));
  }
}
