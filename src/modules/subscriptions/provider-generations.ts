// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: each accepted restart owns its actual original provider resources.
import { randomUUID } from "node:crypto";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { MerchantPhaseScheduleAcknowledgment, MerchantPhaseScheduleInventory } from "@/adapters/payments";
import { ServiceError, type ServiceContext } from "@/core/service";
import { subscriptionProviderGenerations } from "./provider-generation-schema";
import { scheduleQuiescenceCovers } from "./provider-schedule-proof";
import type { subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "./provider-schedule-schema";
import { subscriptions } from "./schema";
type Generation = typeof subscriptionProviderGenerations.$inferSelect;
type Operation = typeof subscriptionProviderScheduleOperations.$inferSelect;
type Resource = typeof subscriptionProviderScheduleResources.$inferSelect;
export async function currentProviderGeneration(ctx: ServiceContext, subscriptionId: string, lock = false) {
  const query = ctx.tx.select().from(subscriptionProviderGenerations).where(eq(subscriptionProviderGenerations.subscriptionId, subscriptionId)).orderBy(desc(subscriptionProviderGenerations.sequence)).limit(1);
  const [generation] = await (lock ? query.for("update") : query); return generation ?? null;
}
export async function operationProviderGeneration(ctx: ServiceContext, operation: Operation) {
  const id = z.uuid().safeParse(operation.originalRequest.generationId);
  if (!id.success) return null; // Retained earlier operations are never backfilled.
  const [generation] = await ctx.tx.select().from(subscriptionProviderGenerations).where(eq(subscriptionProviderGenerations.id, id.data)).limit(1).for("update");
  if (!generation || generation.subscriptionId !== operation.subscriptionId || operation.originalRequest.resourceKind !== "phase_schedule"
    || generation.providerCustomerRef !== operation.originalRequest.providerCustomerRef) throw new ServiceError("conflict", "Restore this operation's actual original generation before retaining new facts.");
  return generation;
}
export async function admitProviderGeneration(ctx: ServiceContext, value: { subscriptionId: string; termsId: string; operationId: string; providerCustomerRef: string;
  providerScheduleRef?: string; resource: Resource; operations: readonly Operation[] }) {
  const previous = await currentProviderGeneration(ctx, value.subscriptionId, true);
  if (value.providerScheduleRef) {
    if (!previous || previous.termsId !== value.termsId || previous.providerScheduleRef !== value.providerScheduleRef) throw new ServiceError("conflict", "An extension must keep its actual current original generation.");
    return previous;
  }
  if (!previous && value.operations.some(operation => operation.originalRequest.resourceKind === "phase_schedule")) throw new ServiceError("conflict", "Recover the original generation source; historical provider work cannot be reconstructed as fresh admission.");
  if (previous && (previous.termsId === value.termsId || !scheduleQuiescenceCovers(value.resource, value.operations))) throw new ServiceError("conflict", "A new generation needs another explicit accepted amendment and complete current predecessor quiescence.");
  const [predecessor] = previous ? await ctx.tx.execute<{ digest: string }>(sql`select encode(sha256(convert_to(stopped_proof::text,'UTF8')),'hex') as digest from subscription_provider_schedule_resources where subscription_id=${value.subscriptionId}::uuid`) : [];
  const generation = { id: randomUUID(), subscriptionId: value.subscriptionId, sequence: (previous?.sequence ?? 0) + 1, previousGenerationId: previous?.id ?? null,
    termsId: value.termsId, firstOperationId: value.operationId, predecessorProofDigest: previous ? predecessor?.digest ?? null : null,
    providerCustomerRef: value.providerCustomerRef, providerScheduleRef: null, providerSubscriptionRef: null };
  await ctx.tx.execute(sql`select set_config('freeholder.subscription_generation_v1','1',true)`);
  await ctx.tx.insert(subscriptionProviderGenerations).values(generation); return generation;
}
export async function retainGenerationAcknowledgment(ctx: ServiceContext, operation: Operation, actual: MerchantPhaseScheduleAcknowledgment) {
  const generation = await operationProviderGeneration(ctx, operation); if (!generation) return;
  if (generation.providerScheduleRef && generation.providerScheduleRef !== actual.providerScheduleRef) return; // Contradictory positives remain in the original journal.
  const [olderOwner] = await ctx.tx.select({ id: subscriptionProviderGenerations.id }).from(subscriptionProviderGenerations).where(and(
    eq(subscriptionProviderGenerations.subscriptionId, generation.subscriptionId), ne(subscriptionProviderGenerations.id, generation.id),
    eq(subscriptionProviderGenerations.providerScheduleRef, actual.providerScheduleRef))).limit(1);
  if (olderOwner) return; // Retain the positive in its journal without adopting an older generation’s resource.
  if (!generation.providerScheduleRef) {
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_generation_v1','1',true)`);
    await ctx.tx.update(subscriptionProviderGenerations).set({ providerScheduleRef: actual.providerScheduleRef }).where(eq(subscriptionProviderGenerations.id, generation.id));
  }
}
/** A valid DTO cannot adopt a resource already owned by another generation.
 * Keep its original physical ACK and caller finish as debt instead. */
export async function generationInventoryMatches(ctx: ServiceContext, generation: Generation, actual: MerchantPhaseScheduleInventory) {
  if (generation.providerScheduleRef !== actual.providerScheduleRef || generation.providerCustomerRef !== actual.providerCustomerRef
    || generation.providerSubscriptionRef && generation.providerSubscriptionRef !== actual.providerSubscriptionRef) return false;
  if (!actual.providerSubscriptionRef) return true;
  const [otherOwner] = await ctx.tx.select({ id: subscriptionProviderGenerations.id }).from(subscriptionProviderGenerations).where(and(
    eq(subscriptionProviderGenerations.subscriptionId, generation.subscriptionId), ne(subscriptionProviderGenerations.id, generation.id),
    eq(subscriptionProviderGenerations.providerSubscriptionRef, actual.providerSubscriptionRef))).limit(1);
  return !otherOwner;
}
export async function retainGenerationInventory(ctx: ServiceContext, operation: Operation, actual: MerchantPhaseScheduleInventory) {
  const generation = await operationProviderGeneration(ctx, operation); if (!generation) return null;
  if (generation.providerScheduleRef !== actual.providerScheduleRef || generation.providerCustomerRef !== actual.providerCustomerRef
    || generation.providerSubscriptionRef && generation.providerSubscriptionRef !== actual.providerSubscriptionRef) throw new ServiceError("conflict", "The actual generation inventory changed its original resource or customer.");
  await ctx.tx.execute(sql`select set_config('freeholder.subscription_generation_v1','1',true)`);
  if (actual.providerSubscriptionRef) await ctx.tx.update(subscriptionProviderGenerations).set({ providerSubscriptionRef: actual.providerSubscriptionRef }).where(eq(subscriptionProviderGenerations.id, generation.id));
  const current = await currentProviderGeneration(ctx, generation.subscriptionId);
  if (current?.id === generation.id && actual.providerSubscriptionRef) await ctx.tx.update(subscriptions).set({ providerRef: actual.providerSubscriptionRef }).where(eq(subscriptions.id, generation.subscriptionId));
  return generation;
}
export function generationMaterial(generation: Generation | null | undefined) {
  return generation ? [generation.id, generation.sequence, generation.termsId, generation.firstOperationId, generation.providerScheduleRef, generation.providerSubscriptionRef, generation.providerCustomerRef] : null;
}
/** Authenticated positive money may establish an actual new generation link
 * before a create ACK returns. It cannot rewrite an older/current generation. */
export async function retainGenerationCashLink(ctx: ServiceContext, operation: Operation, value: { providerSubscriptionRef: string; providerCustomerRef?: string; customerChargeVerified: boolean }) {
  const generation = await operationProviderGeneration(ctx, operation);
  if (!generation || !value.customerChargeVerified || value.providerCustomerRef !== generation.providerCustomerRef
    || generation.providerSubscriptionRef && generation.providerSubscriptionRef !== value.providerSubscriptionRef) return;
  const [otherOwner] = await ctx.tx.select({ id: subscriptionProviderGenerations.id }).from(subscriptionProviderGenerations).where(and(
    eq(subscriptionProviderGenerations.subscriptionId, generation.subscriptionId), ne(subscriptionProviderGenerations.id, generation.id),
    eq(subscriptionProviderGenerations.providerSubscriptionRef, value.providerSubscriptionRef))).limit(1);
  if (otherOwner) return;
  await ctx.tx.execute(sql`select set_config('freeholder.subscription_generation_v1','1',true)`);
  if (!generation.providerSubscriptionRef) await ctx.tx.update(subscriptionProviderGenerations).set({ providerSubscriptionRef: value.providerSubscriptionRef }).where(eq(subscriptionProviderGenerations.id, generation.id));
  const current = await currentProviderGeneration(ctx, generation.subscriptionId);
  if (current?.id === generation.id) await ctx.tx.update(subscriptions).set({ providerRef: value.providerSubscriptionRef }).where(eq(subscriptions.id, generation.subscriptionId));
}
/** A fully verified zero or paid invoice also establishes actual linkage;
 * this is an invoice witness, never a fabricated zero-value cash receipt. */
export async function retainGenerationInvoiceLink(ctx: ServiceContext, operation: Operation, value: { providerSubscriptionRef: string; providerCustomerRef: string }) {
  const generation = await operationProviderGeneration(ctx, operation);
  if (!generation || value.providerCustomerRef !== generation.providerCustomerRef || generation.providerSubscriptionRef && generation.providerSubscriptionRef !== value.providerSubscriptionRef) return;
  const [otherOwner] = await ctx.tx.select({ id: subscriptionProviderGenerations.id }).from(subscriptionProviderGenerations).where(and(
    eq(subscriptionProviderGenerations.subscriptionId, generation.subscriptionId), ne(subscriptionProviderGenerations.id, generation.id),
    eq(subscriptionProviderGenerations.providerSubscriptionRef, value.providerSubscriptionRef))).limit(1);
  if (otherOwner) return;
  await ctx.tx.execute(sql`select set_config('freeholder.subscription_generation_v1','1',true)`);
  if (!generation.providerSubscriptionRef) await ctx.tx.update(subscriptionProviderGenerations).set({ providerSubscriptionRef: value.providerSubscriptionRef }).where(eq(subscriptionProviderGenerations.id, generation.id));
  const current = await currentProviderGeneration(ctx, generation.subscriptionId);
  if (current?.id === generation.id) await ctx.tx.update(subscriptions).set({ providerRef: value.providerSubscriptionRef }).where(eq(subscriptions.id, generation.subscriptionId));
}
