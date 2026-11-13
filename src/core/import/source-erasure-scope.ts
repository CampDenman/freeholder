// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C3.47: only the actual initial transaction may seal original uploads.
import { createHash } from "node:crypto";
import { and, asc, eq, like, sql } from "drizzle-orm";
import { z } from "zod";
import { auditLog } from "@/core/events/schema";
import { mediaObjects } from "@/core/media/schema";
import { importRuns, importSourceGraphs } from "@/core/plugins/schema";
import { dataRequestArtifacts, dataRequests } from "@/core/privacy/schema";
import { ServiceError, type ServiceContext, type Tx } from "@/core/service";
import { importSourceObjectKeys, retainedSourceFromRun } from "./retained-source";
import { importSourceErasureScopes, importSourceErasureMembers, importSourceErasureObjects } from "./source-erasure-schema";

export const sourceObjectKey = z.string().regex(/^imports\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/\d{5}\.part$/);
const recover = () => new ServiceError("conflict", "The original uploaded-source erasure membership needs reviewed recovery; no later or empty source set was assumed.");
export async function originalSourceErasureScopeAvailable(tx: Pick<Tx, "execute">): Promise<boolean> {
  const [row] = await tx.execute<{ available: boolean }>(sql`select to_regprocedure('public.freeholder_source_erasure_scope_complete(uuid)') is not null
    and to_regprocedure('public.freeholder_source_graph_projection_retired(uuid,uuid)') is not null as available`);
  if (!row?.available) return false;
  const [guards] = await tx.execute<{ available: boolean }>(sql`select count(*)=10 as available from (values
    ('public.import_source_erasure_scopes','import_source_erasure_scopes_capture','public.freeholder_guard_source_erasure_capture()'),
    ('public.import_source_erasure_members','import_source_erasure_members_capture','public.freeholder_guard_source_erasure_capture()'),
    ('public.import_source_erasure_objects','import_source_erasure_objects_capture','public.freeholder_guard_source_erasure_capture()'),
    ('public.import_source_erasure_scopes','import_source_erasure_scopes_complete','public.freeholder_require_source_erasure_capture()'),
    ('public.data_requests','data_requests_uploaded_source_erasure_completion','public.freeholder_require_source_erasure_completion()'),
    ('public.import_source_graphs','import_source_graphs_erasure_admission','public.freeholder_refuse_erased_source_graph_admission()'),
    ('public.import_source_graphs','import_source_graphs_identity_guard','public.freeholder_guard_import_graph_identity()'),
    ('public.import_source_entries','import_source_entries_identity_guard','public.freeholder_guard_import_entry_identity()'),
    ('public.import_source_media','import_source_media_identity_guard','public.freeholder_guard_import_media_identity()'),
    ('public.import_source_media','import_source_media_crawl_key_capture','public.freeholder_guard_crawl_media_key_capture()')
  ) required(table_name,trigger_name,function_name)
  join pg_trigger guard on guard.tgrelid=to_regclass(required.table_name) and guard.tgname=required.trigger_name and guard.tgfoid=to_regprocedure(required.function_name)
  where not guard.tgisinternal and guard.tgenabled in ('O','A')`);
  return Boolean(guards?.available);
}
export async function originalSourceErasureScopeComplete(tx: Pick<Tx, "execute">, requestId: string): Promise<boolean> {
  if (!await originalSourceErasureScopeAvailable(tx)) return false;
  const [row] = await tx.execute<{ complete: boolean }>(sql`select freeholder_source_erasure_scope_complete(${requestId}::uuid) as complete`);
  return Boolean(row?.complete);
}
export async function captureOriginalSourceErasureScope(ctx: ServiceContext, requestId: string): Promise<void> {
  const tx = ctx.tx;
  if (!await originalSourceErasureScopeAvailable(tx)) throw recover();
  const [header] = await tx.select().from(importSourceErasureScopes).where(eq(importSourceErasureScopes.requestId, requestId));
  if (header) { if (!await originalSourceErasureScopeComplete(tx, requestId)) throw recover(); return; }
  const [request] = await tx.select().from(dataRequests).where(eq(dataRequests.id, requestId));
  const [artifact] = await tx.select({ id: dataRequestArtifacts.id }).from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, requestId));
  const [applied] = await tx.select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.action, "contacts.fulfillDataRequest"), eq(auditLog.subjectType, "dataRequest"), eq(auditLog.subjectId, requestId)));
  if (!request || request.kind !== "erasure" || request.status !== "verified" || artifact || applied) throw recover();
  const members: Array<typeof importSourceErasureMembers.$inferInsert> = [];
  const objects: Array<typeof importSourceErasureObjects.$inferInsert> = [];
  let after: string | undefined;
  while (true) {
    const [run] = await tx.select().from(importRuns).where(after ? sql`${importRuns.id}>${after}::uuid` : undefined).orderBy(asc(importRuns.id)).limit(1).for("update");
    if (!run) break; after = run.id;
    const raw = await tx.select({ key: mediaObjects.key }).from(mediaObjects).where(like(mediaObjects.key, `imports/${run.id}/%`));
    const keys = [...new Set([...importSourceObjectKeys(run), ...raw.map(row => row.key)])].sort();
    const [graph] = await tx.select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, run.id)).for("update");
    const [http] = graph ? await tx.execute<{ linked: boolean }>(sql`select exists(select 1 from import_crawl_graphs where graph_id=${graph.id}::uuid) linked`) : [];
    const retained = retainedSourceFromRun(run);
    if (graph && !http?.linked && (!retained || retained.revision !== graph.sourceRevision || !keys.some(key => key.split("/")[2] === retained.uploadId))) throw recover();
    const groups = new Map<string, string[]>();
    for (const key of keys) { sourceObjectKey.parse(key); const uploadId = z.uuid().parse(key.split("/")[2]); groups.set(uploadId, [...(groups.get(uploadId) ?? []), key]); }
    for (const [uploadId, originals] of groups) {
      const ownGraph = graph && !http?.linked && retained?.uploadId === uploadId && retained.revision === graph.sourceRevision ? graph : undefined;
      members.push({ requestId, runId: run.id, uploadId, chunkCount: originals.length,
        graphId: ownGraph?.id ?? null, graphGeneration: ownGraph?.generation ?? null, sourceRevision: ownGraph?.sourceRevision ?? null });
      objects.push(...originals.map(key => ({ requestId, runId: run.id, uploadId, chunkIndex: Number(key.split("/")[3]!.slice(0,5)), keyDigest: createHash("sha256").update(key).digest("hex") })));
    }
    if (members.length > 10_000 || objects.length > 250_000) throw recover();
  }
  await tx.execute(sql`select set_config('freeholder.import_source_erasure_request',${requestId},true)`);
  await tx.insert(importSourceErasureScopes).values({ requestId, sourceCount: members.length, objectCount: objects.length });
  for (let at=0; at<members.length; at+=500) await tx.insert(importSourceErasureMembers).values(members.slice(at,at+500));
  for (let at=0; at<objects.length; at+=500) await tx.insert(importSourceErasureObjects).values(objects.slice(at,at+500));
}
