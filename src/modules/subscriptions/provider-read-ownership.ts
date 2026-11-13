// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: short original-ticket transactions; no provider I/O.
import { eq, sql } from "drizzle-orm";
import { ServiceError, type ServiceContext } from "@/core/service";
import { merchantPhysicalCaller } from "@/modules/invoicing/merchant-physical-caller";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { originalProviderReadsFinished } from "./provider-schedule-read-proof";
import { originalProviderReadAdmission, signProviderReadProof, verifiedProviderReadProof } from "./provider-read-signatures";
import { subscriptionProviderReadFinishes, subscriptionProviderReadStops, subscriptionProviderReadTickets } from "./provider-read-ownership-schema";
import type { subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "./provider-schedule-schema";
type Operation = typeof subscriptionProviderScheduleOperations.$inferSelect;
export async function assertProviderReaderSchema(ctx: ServiceContext) {
  const [result] = await ctx.tx.execute<{ ready: boolean }>(sql`select count(*)=8 as ready from pg_trigger where not tgisinternal and tgenabled in('O','A') and(tgrelid,tgname) in
    ((to_regclass('subscription_provider_read_tickets'),'subscription_provider_read_tickets_guard'),(to_regclass('subscription_provider_read_finishes'),'subscription_provider_read_finishes_guard'),
     (to_regclass('subscription_provider_read_stops'),'subscription_provider_read_stops_guard'),(to_regclass('subscription_provider_schedule_operations'),'subscription_provider_reader_history_guard'),
     (to_regclass('subscription_provider_schedule_resources'),'subscription_provider_readers_quiescence_guard'),
     (to_regclass('subscription_provider_read_tickets'),'subscription_provider_read_tickets_projection'),(to_regclass('subscription_provider_read_finishes'),'subscription_provider_read_finishes_projection'),
     (to_regclass('subscription_provider_read_stops'),'subscription_provider_read_stops_projection'))`);
  if (result?.ready !== true) throw new ServiceError("conflict", "Install the complete guarded original reader schema before admitting another provider GET.");
}
export function providerReaderSourceRevision(operation: Operation, resource: typeof subscriptionProviderScheduleResources.$inferSelect) {
  return merchantTaxDigest({ operation, resource });
}
export async function assertProviderReadNotStopped(ctx: ServiceContext, readId: string) {
  const [stop] = await ctx.tx.select({ id: subscriptionProviderReadStops.readId }).from(subscriptionProviderReadStops).where(eq(subscriptionProviderReadStops.readId, readId)).limit(1);
  if (stop) throw new ServiceError("conflict", "This original reader was independently stopped. Preserve its old evidence and use a freshly admitted GET; late callbacks are refused.");
}
export async function captureProviderReadAdmission(ctx: ServiceContext, operation: Operation, resource: typeof subscriptionProviderScheduleResources.$inferSelect, entry: Record<string, unknown>) {
  await assertProviderReaderSchema(ctx);
  if (!originalProviderReadsFinished(operation)) throw new ServiceError("conflict", "The exact earlier provider reader is live or unresolved. Restore its actual finish or review its authentic runtime stop before another GET.");
  const caller = merchantPhysicalCaller();
  if (entry.callerId !== caller.id || entry.operationId !== operation.id || entry.requestDigest !== operation.requestDigest || typeof entry.readId !== "string") throw new ServiceError("permission", "Only the actual original reader can capture this admission.");
  const ownership = signProviderReadProof("admission", { readId: entry.readId, operationId: operation.id, subscriptionId: operation.subscriptionId, requestDigest: operation.requestDigest,
    completionDigest: entry.completionDigest, callerId: caller.id, caller, admissionDigest: merchantTaxDigest(entry), sourceRevision: providerReaderSourceRevision(operation, resource) });
  const admission = { ...entry, ownership };
  if (Buffer.byteLength(JSON.stringify(admission)) > 128000) throw new ServiceError("conflict", "The exact original signed reader admission exceeds its bounded evidence budget.");
  await ctx.tx.execute(sql`select set_config('freeholder.subscription_provider_read_v1','1',true)`);
  await ctx.tx.insert(subscriptionProviderReadTickets).values({ readId: entry.readId, operationId: operation.id, subscriptionId: operation.subscriptionId, admission, admissionDigest: merchantTaxDigest(admission) });
  return admission;
}
export async function captureProviderReadFinish(ctx: ServiceContext, operation: Operation, entry: Record<string, unknown>, facts: unknown) {
  const readId = typeof entry.readId === "string" ? entry.readId : "";
  await assertProviderReadNotStopped(ctx, readId);
  const [ticket] = await ctx.tx.select().from(subscriptionProviderReadTickets).where(eq(subscriptionProviderReadTickets.readId, readId)).limit(1);
  if (!ticket) return entry; // Genuine old wrapper finish; never manufacture a historical ticket.
  const admission = verifiedProviderReadProof(ticket.admission.ownership, "admission");
  if (!admission || !originalProviderReadAdmission(ticket.admission) || ticket.admissionDigest !== merchantTaxDigest(ticket.admission)
    || ticket.operationId !== operation.id || ticket.subscriptionId !== operation.subscriptionId || admission.payload.callerId !== merchantPhysicalCaller().id
    || entry.completionDigest !== admission.payload.completionDigest || !["returned", "threw"].includes(String(entry.outcome))) throw new ServiceError("permission", "Restore this actual original signed reader before its finish.");
  const proof = signProviderReadProof("finish", { readId, operationId: operation.id, subscriptionId: operation.subscriptionId, requestDigest: operation.requestDigest,
    admissionDigest: ticket.admissionDigest, callerId: admission.payload.callerId, completionDigest: entry.completionDigest, outcome: entry.outcome, factsDigest: merchantTaxDigest(facts) });
  if (proof.publicKey !== admission.publicKey) throw new ServiceError("permission", "Only the original process signing key can acknowledge its actual reader finish.");
  await ctx.tx.execute(sql`select set_config('freeholder.subscription_provider_read_v1','1',true)`);
  await ctx.tx.insert(subscriptionProviderReadFinishes).values({ readId, proof, proofDigest: merchantTaxDigest(proof) }).onConflictDoNothing();
  const [saved] = await ctx.tx.select().from(subscriptionProviderReadFinishes).where(eq(subscriptionProviderReadFinishes.readId, readId)).limit(1);
  if (!saved || saved.proofDigest !== merchantTaxDigest(proof)) throw new ServiceError("conflict", "Preserve the first exact actual reader finish.");
  return { ...entry, ownership: proof };
}
