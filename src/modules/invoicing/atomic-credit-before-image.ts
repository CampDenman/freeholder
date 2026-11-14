// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: source-owned exact preimages, never caller-supplied field subtraction.
import {inArray,sql} from "drizzle-orm";
import {z} from "zod";
import {ServiceError,type Tx} from "@/core/service";
import {invoices} from "./schema";
import {atomicCreditInvoiceProjection,atomicCreditProrationProjection,atomicCreditSubscriptionProjection} from "./atomic-credit-before-image-contract";
import type {AtomicCreditFeeCurrentEntry} from "./atomic-credit-fee-partition-contract";
export async function captureAtomicCreditInvoiceProjections(tx:Tx,actualEntries:readonly AtomicCreditFeeCurrentEntry[]){
 const entries=actualEntries.filter(entry=>entry.key.startsWith("invoices:"));
 const ids=entries.map(entry=>z.uuid().parse(entry.key.slice("invoices:".length)));
 if(actualEntries.length>5000||new Set(ids).size!==ids.length)throw new ServiceError("conflict","Restore the exact bounded original invoice projection preimage.");
 if(!ids.length)return[];
 const rows=await tx.select({row:invoices,fingerprint:sql<string>`encode(sha256(convert_to(to_jsonb(${invoices})::text,'UTF8')),'hex')`,
  paidAt:sql<string|null>`to_jsonb(${invoices})->>'paid_at'`,updatedAt:sql<string>`to_jsonb(${invoices})->>'updated_at'`}).from(invoices).where(inArray(invoices.id,ids)).limit(5001);
 if(rows.length!==ids.length||rows.some(value=>entries.find(entry=>entry.key===`invoices:${value.row.id}`)?.postgres_row!==value.fingerprint))
  throw new ServiceError("conflict","The actual original invoice changed while retaining its full-row projection preimage.");
 // Keep PostgreSQL's actual timestamp precision/offset. JS Date would erase
 // microseconds and make an exact deferred full-row reconstruction impossible.
 return rows.map(({row,paidAt,updatedAt})=>atomicCreditInvoiceProjection.parse({invoiceId:row.id,creditedMinor:row.creditedMinor,status:row.status,paidAt,updatedAt})).sort((a,b)=>a.invoiceId.localeCompare(b.invoiceId));
}
/** Exact existing shared-writer columns only. The caller cannot supply a
 * before body: actual complete PG hashes must first match its current graph.
 * Capture does not itself permit a deferred mutation or historical rewind. */
export async function captureAtomicCreditOwnerProjections(tx:Tx,actualEntries:readonly AtomicCreditFeeCurrentEntry[]){
 if(actualEntries.length>5000)throw new ServiceError("conflict","Restore the complete bounded actual original owner preimage.");
 const ids=(table:string)=>actualEntries.filter(entry=>entry.key.startsWith(`${table}:`)).map(entry=>z.uuid().parse(entry.key.slice(table.length+1)));
 const subscriptionIds=ids("subscriptions"),prorationIds=ids("subscription_prorations");
 if(new Set(subscriptionIds).size!==subscriptionIds.length||new Set(prorationIds).size!==prorationIds.length)throw new ServiceError("conflict","Retain each exact owner physical identity once.");
 const list=(values:readonly string[])=>sql.join(values.map(id=>sql`${id}::uuid`),sql`, `);
 const subscriptions=subscriptionIds.length?await tx.execute<{subscriptionId:string;pendingPlanId:string|null;updatedAt:string;fingerprint:string}>(sql`select actual_owner.id::text as "subscriptionId",actual_owner.pending_plan_id::text as "pendingPlanId",to_jsonb(actual_owner)->>'updated_at' as "updatedAt",encode(sha256(convert_to(to_jsonb(actual_owner)::text,'UTF8')),'hex') as fingerprint
  from subscriptions actual_owner where actual_owner.id in(${list(subscriptionIds)}) order by actual_owner.id limit 5001`):[];
 const prorations=prorationIds.length?await tx.execute<{prorationId:string;originalJobId:string|null;jobClaimDigest:string|null;originalTask:unknown;state:string;fingerprint:string}>(sql`select actual_owner.id::text as "prorationId",actual_owner.original_job_id::text as "originalJobId",actual_owner.job_claim_digest as "jobClaimDigest",actual_owner.original_task as "originalTask",actual_owner.state,encode(sha256(convert_to(to_jsonb(actual_owner)::text,'UTF8')),'hex') as fingerprint
  from subscription_prorations actual_owner where actual_owner.id in(${list(prorationIds)}) order by actual_owner.id limit 5001`):[];
 if(subscriptions.length!==subscriptionIds.length||prorations.length!==prorationIds.length
  ||subscriptions.some(row=>actualEntries.find(entry=>entry.key===`subscriptions:${row.subscriptionId}`)?.postgres_row!==row.fingerprint)
  ||prorations.some(row=>actualEntries.find(entry=>entry.key===`subscription_prorations:${row.prorationId}`)?.postgres_row!==row.fingerprint))throw new ServiceError("conflict","The actual complete original owner changed while capturing its exact guarded continuation fields.");
 return{beforeSubscriptionProjections:subscriptions.map(row=>atomicCreditSubscriptionProjection.parse({subscriptionId:row.subscriptionId,pendingPlanId:row.pendingPlanId,updatedAt:row.updatedAt})),
  beforeProrationProjections:prorations.map(row=>atomicCreditProrationProjection.parse({prorationId:row.prorationId,originalJobId:row.originalJobId,jobClaimDigest:row.jobClaimDigest,originalTask:row.originalTask,state:row.state}))};
}
