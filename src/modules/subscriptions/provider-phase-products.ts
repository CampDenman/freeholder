// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: actual auxiliary creation has its own short claim, ACK and finish.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { paymentAdapter } from "@/adapters/payments";
import { stripeMerchantPhaseProductBody } from "@/adapters/payments/stripe-subscription-phase-product";
import { lockContactIdentity } from "@/core/contacts/identity-lock";
import { contacts } from "@/core/contacts/schema";
import { dataRequests, privacyRetentionExceptions } from "@/core/privacy/schema";
import { defineOrchestratedService, defineService, ServiceError, type ServiceContext } from "@/core/service";
import { moduleSettings } from "@/core/settings/schema";
import { merchantPhysicalCaller } from "@/modules/invoicing/merchant-physical-caller";
import { merchantTaxProfiles } from "@/modules/invoicing/merchant-tax-schema";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { quoteMerchantProviderHorizon } from "./provider-phase-quote";
import { commercialBillingStart } from "./commercial-amendment-calendar";
import { originalMerchantTerms } from "./merchant-terms-read";
import { subscriptionChargeScope } from "./merchant-scope-contract";
import { subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "./provider-schedule-schema";
import { subscriptions } from "./schema";
import { scheduleCallerHasStopped } from "./provider-schedule-proof";
import { verifiedOriginalPhaseProduct } from "./provider-phase-product-proof";
import { enqueueMerchantScheduleErasureRepair } from "./provider-schedule-erasure";
import productRecoveryServices, { flushMerchantPhaseProductReads } from "./provider-phase-product-recovery";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const account = z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200);
const productRef = z.string().regex(/^prod_[A-Za-z0-9]{1,195}$/);
const request = z.object({ subscriptionId: z.uuid(), operationId: z.uuid(), name: z.string().min(1).max(500), idempotencyKey: z.string().min(1).max(200),
  providerPlatformAccountId: account, providerAccountId: account.optional(), destinationAccountId: account.optional(), settlementMerchantAccountId: account.optional(),
  providerScheduleApiVersion: z.literal("2026-10-28.endive") });
const dispatch = z.object({ mode: z.literal("dispatch"), operationId: z.uuid(), completionNonce: z.string(), request });
const output = z.discriminatedUnion("mode", [dispatch, z.object({ mode: z.literal("known"), providerProductRef: productRef })]);
type Local = { subscriptionId: string; nonce: string; invoked: boolean; outcome: "returned" | "threw" | null; positives: string[]; result?: string };
const slot = Symbol.for("freeholder.subscription.phase-product-callers.v1");
const state = globalThis as typeof globalThis & { [slot]?: Map<string, Local> };
const callers = state[slot] ??= new Map<string, Local>();

/** The caller shares actual identity/profile/period locks. This is admission,
 * never evidence that an external effect or an old caller has stopped. */
export async function originalProductAdmission(ctx: ServiceContext, subscriptionId: string, additionalPeriods = 1) {
  await lockContactIdentity(ctx.tx);
  const adapter = paymentAdapter("stripe");
  if (adapter.id !== "stripe" || !adapter.status.available || !adapter.createMerchantPhaseProduct || !adapter.inspectMerchantPhaseProduct) throw new ServiceError("conflict", "Connect the supported original provider before admitting auxiliary work.");
  const [enabled] = await ctx.tx.select({ enabled: moduleSettings.enabled }).from(moduleSettings).where(eq(moduleSettings.module, "subscriptions")).limit(1);
  if (!enabled?.enabled) throw new ServiceError("conflict", "Enable the original subscriptions module before admitting new provider work.");
  const [parent] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1).for("update");
  if (!parent || parent.provider !== "stripe" || parent.merchantScopeVersion !== 1 || parent.billingMode !== "provider") throw new ServiceError("conflict", "This is not an original new merchant provider agreement.");
  const calendar = await commercialBillingStart(ctx, parent);
  if (!calendar.ready) throw new ServiceError("conflict", "Complete the current accepted original amendment's provider stop before admitting another billing horizon.");
  const horizon = await ctx.callAsSystem(quoteMerchantProviderHorizon, { subscriptionId, additionalPeriods });
  const terms = await originalMerchantTerms(ctx, parent, calendar.start);
  if (!terms || terms.id !== horizon.termsId) throw new ServiceError("conflict", "Restore the actual accepted original commercial terms before provider work.");
  const [profile] = await ctx.tx.select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id, terms.profileId)).limit(1).for("update");
  if (!profile || profile.state !== "active" || profile.currentVersion !== terms.profileVersion || !profile.contactId) throw new ServiceError("conflict", "The accepted original merchant tax business changed or was erased.");
  const owners = [...new Set([parent.contactId, profile.contactId])];
  const people = await ctx.tx.select({ id: contacts.id, source: contacts.source }).from(contacts).where(inArray(contacts.id, owners));
  if (people.length !== owners.length || people.some(person => person.source === "privacy-erasure")) throw new ServiceError("conflict", "Original buyer and merchant identities must remain available before new provider admission.");
  const [erasure] = await ctx.tx.select({ id: dataRequests.id }).from(dataRequests).where(and(inArray(dataRequests.contactId, owners), eq(dataRequests.kind, "erasure"),
    isNotNull(dataRequests.verifiedAt), inArray(dataRequests.status, ["verified", "in_progress", "completed", "partially_completed"]))).limit(1);
  const [hold] = await ctx.tx.select({ id: privacyRetentionExceptions.id }).from(privacyRetentionExceptions).innerJoin(dataRequests, eq(dataRequests.id, privacyRetentionExceptions.dataRequestId))
    .where(and(inArray(dataRequests.contactId, owners), inArray(privacyRetentionExceptions.scope, ["commerce.money", "commerce.merchantTax", "subscriptions.agreements", "privacy.records"]),
      or(sql`${privacyRetentionExceptions.expiresAt} is null`, sql`${privacyRetentionExceptions.expiresAt}>clock_timestamp()`))).limit(1);
  if (erasure || hold) throw new ServiceError("conflict", "Original buyer or merchant privacy work prevents new provider creation.");
  return { parent, horizon, terms };
}

export const claimMerchantPhaseProduct = defineService({
  name: "subscriptions.claimMerchantPhaseProduct", summary: "Commit one exact original auxiliary-product creation before its physical POST.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", auditInputFields: ["subscriptionId"], input: z.object({ subscriptionId: z.uuid() }), output,
  handler: async ({ subscriptionId }, ctx) => {
    const { horizon, terms } = await originalProductAdmission(ctx, subscriptionId);
    const [resource] = await ctx.tx.select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, subscriptionId)).limit(1).for("update");
    if (!resource) throw new ServiceError("conflict", "Restore the original resource journal before admitting its product.");
    const operations = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.subscriptionId, subscriptionId)).orderBy(subscriptionProviderScheduleOperations.operationRevision).limit(5001);
    if (operations.length > 5000 || operations.length !== resource.operationRevision || operations.some((operation, index) => operation.operationRevision !== index + 1)) throw new ServiceError("conflict", "Restore the complete original operation inventory before new provider work.");
    const prior = operations.filter(operation => operation.kind === "create_product");
    if (prior.length) {
      if (prior.length !== 1 || prior[0]!.state !== "confirmed" || !scheduleCallerHasStopped(prior[0]!)) throw new ServiceError("conflict", "Recover the actual original auxiliary product instead of admitting another POST.");
      const providerProductRef = verifiedOriginalPhaseProduct(prior[0]!);
      if (!providerProductRef) throw new ServiceError("conflict", "Restore the independently verified original auxiliary product receipt.");
      return { mode: "known" as const, providerProductRef };
    }
    if (operations.length || resource.state !== "uncreated" || resource.providerSubscriptionRef || resource.recoveryPending) throw new ServiceError("conflict", "Existing original provider history requires recovery, not a new product creation.");
    const operationId = randomUUID(), nonce = randomBytes(32).toString("base64url");
    const providerRequest = request.parse({ ...subscriptionChargeScope(horizon.originalScope), providerPlatformAccountId: horizon.originalScope.providerPlatformAccountId,
      providerScheduleApiVersion: horizon.originalScope.providerScheduleApiVersion, subscriptionId, operationId, name: terms.snapshot.name, idempotencyKey: `phase-product:${operationId}` });
    const originalRequest = { ...providerRequest, resourceKind: "phase_product", physical: { method: "POST", path: "/v1/products", body: Object.fromEntries(stripeMerchantPhaseProductBody(providerRequest)) },
      termsId: terms.id, caller: merchantPhysicalCaller(), callerCompletionDigest: hash(nonce) };
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
    await ctx.tx.update(subscriptionProviderScheduleResources).set({ operationRevision: resource.operationRevision + 1, recoveryPending: true, stoppedProof: null, updatedAt: new Date() }).where(eq(subscriptionProviderScheduleResources.subscriptionId, subscriptionId));
    await ctx.tx.insert(subscriptionProviderScheduleOperations).values({ id: operationId, subscriptionId, operationRevision: resource.operationRevision + 1, kind: "create_product", providerApiVersion: providerRequest.providerScheduleApiVersion,
      originalRequest, requestDigest: merchantTaxDigest(originalRequest), idempotencyKey: providerRequest.idempotencyKey });
    callers.set(operationId, { subscriptionId, nonce, invoked: false, outcome: null, positives: [] });
    ctx.setSubject("subscription", subscriptionId);
    return { mode: "dispatch" as const, operationId, completionNonce: nonce, request: providerRequest };
  },
});

async function ownedProductCaller(ctx: ServiceContext, operationId: string, nonce: string) {
  const local = callers.get(operationId);
  if (!local || !local.invoked || local.nonce !== nonce) throw new ServiceError("permission", "This is not the actual admitted original product caller.");
  await lockContactIdentity(ctx.tx);
  await ctx.tx.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.id, local.subscriptionId)).limit(1).for("update");
  const [resource] = await ctx.tx.select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, local.subscriptionId)).limit(1).for("update");
  const [operation] = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.id, operationId)).limit(1).for("update");
  if (!resource || !operation || operation.kind !== "create_product" || operation.subscriptionId !== local.subscriptionId || merchantTaxDigest(operation.originalRequest) !== operation.requestDigest
    || operation.originalRequest.callerCompletionDigest !== hash(nonce) || z.object({ id: z.uuid() }).parse(operation.originalRequest.caller).id !== merchantPhysicalCaller().id) throw new ServiceError("permission", "Restore the exact original product request and actual caller before retaining its outcome.");
  return { local, operation, resource };
}
async function retainPositive(ctx: ServiceContext, owned: Awaited<ReturnType<typeof ownedProductCaller>>) {
  const { local } = owned;
  let { operation, resource } = owned;
  for (const providerProductRef of local.positives) {
    const history = z.array(z.record(z.string(), z.unknown())).max(5000).parse(operation.providerObservation.history ?? []);
    if (history.some(entry => entry.source === "phase_product_ack" && entry.operationId === operation.id && entry.requestDigest === operation.requestDigest && entry.providerProductRef === providerProductRef)) continue;
    const observation = { ...operation.providerObservation, history: [...history, { source: "phase_product_ack", operationId: operation.id, requestDigest: operation.requestDigest, providerProductRef }] };
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
    await ctx.tx.update(subscriptionProviderScheduleOperations).set({ positiveObserved: true, state: "unknown", providerObservation: observation }).where(eq(subscriptionProviderScheduleOperations.id, operation.id));
    await ctx.tx.update(subscriptionProviderScheduleResources).set({ recoveryPending: true, stoppedProof: null, evidenceRevision: resource.evidenceRevision + 1, updatedAt: new Date() }).where(eq(subscriptionProviderScheduleResources.subscriptionId, resource.subscriptionId));
    await enqueueMerchantScheduleErasureRepair(ctx.tx, { subscriptionId: operation.subscriptionId, evidenceDigest: merchantTaxDigest({ operationId: operation.id, providerProductRef }) });
    operation = { ...operation, providerObservation: observation }; resource = { ...resource, evidenceRevision: resource.evidenceRevision + 1 };
  }
}

export const observeMerchantPhaseProduct = defineService({
  name: "subscriptions.observeMerchantPhaseProduct", summary: "Retain the actual original product ACK independently of later validation or privacy policy.",
  kind: "mutation", permission: "system", external: false, auditInputFields: ["operationId"], input: z.object({ operationId: z.uuid(), completionNonce: z.string() }), output: z.object({ recorded: z.literal(true) }),
  handler: async ({ operationId, completionNonce }, ctx) => { const owned = await ownedProductCaller(ctx, operationId, completionNonce); if (!owned.local.positives.length) throw new ServiceError("permission", "The actual caller has no product ACK yet."); await retainPositive(ctx, owned); return { recorded: true as const }; },
});
export const finishMerchantPhaseProduct = defineService({
  name: "subscriptions.finishMerchantPhaseProduct", summary: "Retain the actual auxiliary-product caller finish separately from its verified resource result.",
  kind: "mutation", permission: "system", external: false, auditInputFields: ["operationId"], input: z.object({ operationId: z.uuid(), completionNonce: z.string() }), output: z.object({ finished: z.literal(true) }),
  handler: async ({ operationId, completionNonce }, ctx) => {
    let owned = await ownedProductCaller(ctx, operationId, completionNonce);
    if (!owned.local.outcome) throw new ServiceError("permission", "The original product promise has not actually finished.");
    await retainPositive(ctx, owned);
    owned = await ownedProductCaller(ctx, operationId, completionNonce);
    const { local, operation, resource } = owned, history = z.array(z.record(z.string(), z.unknown())).max(5000).parse(operation.providerObservation.history ?? []);
    const verified = local.outcome === "returned" && !!local.result && local.positives.length === 1 && local.result === local.positives[0];
    if (!history.some(entry => entry.source === "physical_caller_finished" && entry.operationId === operation.id && entry.completionDigest === hash(completionNonce))) {
      await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
      await ctx.tx.update(subscriptionProviderScheduleOperations).set({ state: verified ? "confirmed" : "unknown", finishedAt: new Date(),
        providerObservation: { ...operation.providerObservation, ...(verified ? { productProof: { version: 1, operationId, requestDigest: operation.requestDigest, providerProductRef: local.result } } : {}),
          history: [...history, ...(verified ? [{ source: "phase_product_read_verified", version: 1, operationId, requestDigest: operation.requestDigest, providerProductRef: local.result }] : []), { source: "physical_caller_finished", operationId, requestDigest: operation.requestDigest, completionDigest: hash(completionNonce), outcome: local.outcome }] } }).where(eq(subscriptionProviderScheduleOperations.id, operationId));
      await ctx.tx.update(subscriptionProviderScheduleResources).set({ recoveryPending: !verified, evidenceRevision: resource.evidenceRevision + 1, updatedAt: new Date() }).where(eq(subscriptionProviderScheduleResources.subscriptionId, resource.subscriptionId));
      await enqueueMerchantScheduleErasureRepair(ctx.tx, { subscriptionId: operation.subscriptionId, evidenceDigest: merchantTaxDigest({ operationId, finished: true, verified }) });
    }
    return { finished: true as const };
  },
});

export async function flushMerchantPhaseProductFinishes(subscriptionId: string) {
  for (const [operationId, local] of callers) if (local.subscriptionId === subscriptionId && local.outcome) {
    await finishMerchantPhaseProduct.call({ operationId, completionNonce: local.nonce }, { kind: "system" }); callers.delete(operationId);
  }
}
export const createMerchantPhaseProduct = defineOrchestratedService({
  name: "subscriptions.createMerchantPhaseProduct", summary: "Prepare one original auxiliary product with its separately committed physical caller.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", input: z.object({ subscriptionId: z.uuid() }), output: z.object({ providerProductRef: productRef }),
  handler: async ({ subscriptionId }) => {
    await flushMerchantPhaseProductFinishes(subscriptionId);
    await flushMerchantPhaseProductReads(subscriptionId);
    const claimed = await claimMerchantPhaseProduct.call({ subscriptionId }, { kind: "system" });
    if (claimed.mode === "known") return { providerProductRef: claimed.providerProductRef };
    const local = callers.get(claimed.operationId);
    if (!local || local.nonce !== claimed.completionNonce || local.invoked) throw new ServiceError("permission", "The original auxiliary-product caller is not available in this process.");
    const adapter = paymentAdapter("stripe");
    local.invoked = true;
    try {
      if (!adapter.createMerchantPhaseProduct) throw new ServiceError("conflict", "Restore the actual original product adapter; no replacement creation is admitted.");
      const value = await adapter.createMerchantPhaseProduct({ ...claimed.request, onProductAcknowledged: async actual => {
        const actualRef = productRef.parse(actual.providerProductRef);
        if (!local.positives.includes(actualRef)) local.positives.push(actualRef); // synchronous before persistence
        await observeMerchantPhaseProduct.call({ operationId: claimed.operationId, completionNonce: local.nonce }, { kind: "system" });
      } });
      local.result = productRef.parse(value.providerProductRef); local.outcome = "returned";
      return value;
    } catch (error) { local.outcome = "threw"; throw error; }
    finally { await finishMerchantPhaseProduct.call({ operationId: claimed.operationId, completionNonce: local.nonce }, { kind: "system" }); callers.delete(claimed.operationId); }
  },
});
export default [claimMerchantPhaseProduct, observeMerchantPhaseProduct, finishMerchantPhaseProduct, createMerchantPhaseProduct, quoteMerchantProviderHorizon, ...productRecoveryServices];
