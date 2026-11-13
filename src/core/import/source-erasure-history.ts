// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C3.47/C11.14: old completed receipts do not prove their private index gone.
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { defineService } from "@/core/service";
import { lockContactIdentity } from "@/core/contacts/identity-lock";
import { dataRequestArtifacts, dataRequests } from "@/core/privacy/schema";
import { erasureArtifactIsIntact, reopenErasureJob } from "@/core/privacy/service";
import { registerStorageObservationReconciler } from "@/core/media/observation-hooks";
import { originalSourceErasureScopeComplete } from "./source-erasure-scope";
import { IMPORT_SOURCE_ERASURE_JOB, IMPORT_SOURCE_ERASURE_SCOPE, IMPORT_SOURCE_RECONCILIATION_JOB, originalUploadedTaskEvidence } from "./source-erasure-contract";

const receipt = z.object({ format: z.literal("freeholder.erasure-receipt"), outcomes: z.array(z.object({ scope: z.string(), outcome: z.string() }).passthrough()) }).passthrough();
const recoveryResolution = "Historical uploaded-source erasure requires reviewed recovery of its original initial membership. No current graph or empty scope was adopted.";
const retryIdentity = "uploaded-initial-scope-v1:";

export const reconcileOriginalSourceErasure = defineService({
  name: "imports.reconcileOriginalSourceErasure", summary: "Reopen retained uploaded erasure tasks whose original initial scope needs reviewed recovery.",
  kind: "mutation", permission: "system", external: false,
  input: z.object({ originalJobId: z.uuid().optional(), receiptId: z.uuid().optional(), after: z.uuid().optional() }),
  output: z.object({ next: z.uuid().nullable(), reopened: z.number().int().nonnegative(), recoveryRequired: z.number().int().nonnegative(), changed: z.boolean() }),
  auditInputFields: ["originalJobId", "receiptId"], auditWhen: (output: { changed: boolean }) => output.changed,
  handler: async (input, ctx) => {
    await lockContactIdentity(ctx.tx);
    // Select only retained self-bound original tasks and verified
    // requests; check the applied audit witness before admitting any retry. No current run, upload, graph or media membership is
    // queried to supply missing original erasure evidence.
    const originals = await ctx.tx.execute<{ id: string; request_id: string; data: unknown }>(sql`
      select job.id,request.id request_id,job.data from pgboss.job job
      join data_requests request on request.id::text=job.data->>'requestId'
      where job.name=${IMPORT_SOURCE_ERASURE_JOB} and job.id::text=job.data->>'originalJobId'
       and request.kind='erasure' and request.verified_at is not null
       and request.status in ('completed','partially_completed','in_progress')
       and (${input.originalJobId ?? null}::uuid is null or job.id=${input.originalJobId ?? null}::uuid)
       and (${input.after ?? null}::uuid is null or job.id>${input.after ?? null}::uuid)
       and not exists(select 1 from job_idempotency_keys retry where retry.job_id=job.id and retry.job_name=${IMPORT_SOURCE_ERASURE_JOB}
         and retry.idempotency_key like 'reopen-erasure:%:imports.readerSources:uploaded-initial-scope-v1:%')
       and (${input.receiptId ?? null}::uuid is null or exists(select 1 from media_object_writes observed
         where observed.id=${input.receiptId ?? null}::uuid and observed.object_key in
          (select jsonb_array_elements_text(case when jsonb_typeof(job.data->'keys')='array' then job.data->'keys' else '[]'::jsonb end))))
      order by job.id limit 100
    `);
    let reopened = 0, recoveryRequired = 0, changed = false;
    for (const original of originals) {
      await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`privacy:${original.request_id}`}))`);
      const [request] = await ctx.tx.select().from(dataRequests).where(eq(dataRequests.id, original.request_id)).for("update");
      if (!request || request.kind !== "erasure" || !request.verifiedAt) continue;
      const task = originalUploadedTaskEvidence(original.data, original.id, request.id);
      const [applied] = await ctx.tx.execute<{ present: boolean }>(sql`select exists(select 1 from audit_log where action='contacts.fulfillDataRequest' and subject_type='dataRequest' and subject_id=${request.id}) present`);
      const [artifact] = await ctx.tx.select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, request.id)).for("update");
      const parsed = receipt.safeParse(artifact?.body);
      const outcome = parsed.success ? parsed.data.outcomes.find(value => value.scope === IMPORT_SOURCE_ERASURE_SCOPE) : undefined;
      if (!task || !applied?.present || outcome && !["erased", "pending", "retained"].includes(outcome.outcome)) {
        // The retained request may need recovery, but an invalid task cannot
        // authorize manufacturing replacement keys, graph members or jobs.
        const marked = await ctx.tx.execute(sql`update data_requests set status='in_progress',fulfilled_at=null,resolution=${recoveryResolution}
          where id=${request.id}::uuid and (status is distinct from 'in_progress' or fulfilled_at is not null or resolution is distinct from ${recoveryResolution}) returning id`);
        changed ||= marked.length > 0; recoveryRequired++; ctx.setSubject("dataRequest", request.id); continue;
      }
      const intact = artifact && erasureArtifactIsIntact(artifact) && parsed.success && parsed.data.outcomes.some(outcome => outcome.scope === IMPORT_SOURCE_ERASURE_SCOPE);
      if (intact && await originalSourceErasureScopeComplete(ctx.tx, request.id)) continue;
      const result = await ctx.call(reopenErasureJob, { requestId: request.id, scope: IMPORT_SOURCE_ERASURE_SCOPE,
        jobName: IMPORT_SOURCE_ERASURE_JOB, jobData: { keys: task.keys }, idempotencyKey: `${retryIdentity}${original.id}` });
      changed ||= result.changed;
      if (result.changed && result.jobId) reopened++;
      recoveryRequired++;
      const marked = await ctx.tx.execute(sql`update data_requests set resolution=${recoveryResolution}
        where id=${request.id}::uuid and resolution is distinct from ${recoveryResolution} returning id`);
      changed ||= marked.length > 0;
      ctx.setSubject("dataRequest", request.id);
    }
    const next = originals.length === 100 ? originals.at(-1)!.id : null;
    if (next) await ctx.queueJob(IMPORT_SOURCE_RECONCILIATION_JOB, { after: next, ...(input.receiptId ? { receiptId: input.receiptId } : {}) });
    return { next, reopened, recoveryRequired, changed };
  },
});

let registered = false;
export function registerOriginalSourceErasureRecovery(): void {
  if (registered) return;
  registerStorageObservationReconciler(IMPORT_SOURCE_ERASURE_SCOPE, async receiptId => {
    await reconcileOriginalSourceErasure.call({ receiptId }, { kind: "system" });
  });
  registered = true;
}
