// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { sql } from 'drizzle-orm';
import { pgTable,uuid,text,timestamp,check,uniqueIndex } from 'drizzle-orm/pg-core';
export const deploymentAdmissionHolds=pgTable('deployment_admission_holds',{
  operationId:uuid('operation_id').primaryKey(),tokenSha256:text('token_sha256').notNull(),sourceRevision:text('source_revision').notNull(),
  phase:text('phase').notNull().default('draining'),heldAt:timestamp('held_at',{withTimezone:true}).notNull().defaultNow(),
  sealedAt:timestamp('sealed_at',{withTimezone:true}),releasedAt:timestamp('released_at',{withTimezone:true}),resumeProof:text('resume_proof'),releaseProof:text('release_proof'),
},t=>[uniqueIndex('deployment_admission_one_active').on(sql`(true)`).where(sql`${t.releasedAt} IS NULL`),
  check('deployment_admission_holds_token_sha256_check',sql`${t.tokenSha256} ~ '^[a-f0-9]{64}$'`),check('deployment_admission_holds_source_revision_check',sql`${t.sourceRevision} ~ '^[a-f0-9]{40}$'`),
  check('deployment_admission_holds_phase_check',sql`${t.phase} IN ('draining','sealed','resuming','released')`),
  check('deployment_admission_holds_resume_proof_check',sql`${t.resumeProof} IN ('published','private_restored')`),
  check('deployment_admission_holds_release_proof_check',sql`${t.releaseProof} IN ('published','private_restored')`),
  check('deployment_admission_holds_check',sql`(${t.phase}='released')=(${t.releasedAt} IS NOT NULL)`)]);
export const deploymentAdmissionRuntimes=pgTable('deployment_admission_runtimes',{
  instanceId:uuid('instance_id').primaryKey(),holdOperationId:uuid('hold_operation_id').references(()=>deploymentAdmissionHolds.operationId),
  state:text('state').notNull(),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[check('deployment_admission_runtimes_state_check',sql`${t.state} IN ('running','draining','drained','stopped')`)]);
