// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: recover frozen scope before provider reads, including a lost create ACK.
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { defineService, ServiceError } from "@/core/service";
import { registerSubscriptionProviderScopeResolver } from "@/modules/invoicing/merchant-provider-stage";
import { subscriptionChargeScope, subscriptionMerchantScope } from "./merchant-scope-contract";
import { subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "./provider-schedule-schema";
import { subscriptionMerchantScopes, subscriptions } from "./schema";

const account = z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200);
const subscriptionReference = z.string().regex(/^sub_[A-Za-z0-9]{1,195}$/);
const output = z.object({
  subscriptionId: z.uuid(), providerSubscriptionRef: subscriptionReference,
  providerPlatformAccountId: account, providerAccountId: account.optional(),
  destinationAccountId: account.optional(), settlementMerchantAccountId: account.optional(),
  providerScheduleApiVersion: z.literal("2026-10-28.endive"),
  providerScheduleOperationId: z.uuid().optional(), providerCustomerRef: z.string().regex(/^cus_[A-Za-z0-9]+$/).max(200).optional(),
});
export const resolveProviderWebhookScope = defineService({
  name: "subscriptions.resolveProviderWebhookScope", summary: "Resolve only an original new agreement or admitted physical operation before authenticated provider reads.",
  kind: "query", permission: "system", external: false, auditInputFields: ["provider", "providerSubscriptionRef"],
  input: z.object({ provider: z.literal("stripe"), providerSubscriptionRef: subscriptionReference,
    providerInvoiceRef: z.string().min(1).max(200).optional(), providerAccountId: account.optional(), metadata: z.record(z.string(), z.unknown()) }),
  output: output.nullable(),
  handler: async (input, ctx) => {
    // The lookup returns the STORED platform. The adapter must verify that
    // platform against its actual credentials before making a resource GET.
    const candidates = await ctx.tx.select({ subscription: subscriptions, scope: subscriptionMerchantScopes })
      .from(subscriptions).innerJoin(subscriptionMerchantScopes, eq(subscriptionMerchantScopes.subscriptionId, subscriptions.id))
      .where(and(eq(subscriptions.provider, input.provider), eq(subscriptions.providerRef, input.providerSubscriptionRef),
        eq(subscriptions.merchantScopeVersion, 1), sql`${subscriptionMerchantScopes.chargeAccountId} is not distinct from ${input.providerAccountId ?? null}`)).limit(2);
    if (candidates.length > 1) throw new ServiceError("conflict", "The authenticated subscription reference has ambiguous original platform ownership.");
    let original = candidates[0];
    let providerScheduleOperationId: string | undefined;
    let expectedCustomer: string | undefined;
    const tagged = input.metadata.freeholder_subscription_scope_version === "1" || input.metadata.freeholder_subscription_operation_id !== undefined;
    const operationId = z.uuid().safeParse(input.metadata.freeholder_subscription_operation_id);
    const subscriptionId = z.uuid().safeParse(input.metadata.freeholder_subscription_id);
    if (!original) {
      if (!tagged) return null; // Historical agreements keep their earlier protocol.
      if (!operationId.success || !subscriptionId.success || input.metadata.freeholder_subscription_scope_version !== "1") throw new ServiceError("conflict", "Recover the original admitted subscription operation before applying this tagged feedback.");
      const [operation] = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(and(
        eq(subscriptionProviderScheduleOperations.id, operationId.data), eq(subscriptionProviderScheduleOperations.subscriptionId, subscriptionId.data))).limit(1);
      if (!operation || !["create", "update", "resume"].includes(operation.kind)) throw new ServiceError("conflict", "This tagged provider subscription has no matching admitted original billing operation.");
      const [known] = await ctx.tx.select({ subscription: subscriptions, scope: subscriptionMerchantScopes }).from(subscriptions)
        .innerJoin(subscriptionMerchantScopes, eq(subscriptionMerchantScopes.subscriptionId, subscriptions.id))
        .where(and(eq(subscriptions.id, subscriptionId.data), eq(subscriptions.merchantScopeVersion, 1),
          sql`${subscriptionMerchantScopes.chargeAccountId} is not distinct from ${input.providerAccountId ?? null}`)).limit(1);
      if (!known || operation.providerApiVersion !== known.scope.providerScheduleApiVersion
        || operation.originalRequest.providerPlatformAccountId !== known.scope.providerPlatformAccountId
        || (operation.originalRequest.providerAccountId ?? null) !== known.scope.chargeAccountId
        || input.metadata.freeholder_platform_account_id !== known.scope.providerPlatformAccountId
        || input.metadata.freeholder_schedule_api_version !== known.scope.providerScheduleApiVersion) throw new ServiceError("conflict", "The tagged operation does not match the original platform and charge namespace.");
      original = known;
      providerScheduleOperationId = operation.id;
      const customer = z.string().regex(/^cus_[A-Za-z0-9]+$/).max(200).safeParse(operation.originalRequest.providerCustomerRef);
      expectedCustomer = customer.success ? customer.data : undefined;
    }
    const scope = subscriptionMerchantScope.parse(original.scope);
    const [resource] = await ctx.tx.select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, original.subscription.id)).limit(1);
    if (!resource) throw new ServiceError("conflict", "Restore this new agreement's original provider resource journal before applying feedback.");
    if (!expectedCustomer) {
      const operations = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.subscriptionId, original.subscription.id)).orderBy(subscriptionProviderScheduleOperations.operationRevision).limit(5001);
      if (operations.length > 5000) throw new ServiceError("conflict", "The original customer lineage exceeds safe webhook recovery bounds.");
      const customerReferences = new Set<string>();
      for (const operation of operations) {
        const history = Array.isArray(operation.providerObservation.history) ? operation.providerObservation.history : [];
        const belongs = operation.originalRequest.providerSubscriptionRef === input.providerSubscriptionRef || history.some(entry => {
          const parsed = z.record(z.string(), z.unknown()).safeParse(entry);
          return parsed.success && parsed.data.providerSubscriptionRef === input.providerSubscriptionRef;
        });
        if (!belongs || !["create", "update", "resume"].includes(operation.kind)) continue;
        const customer = z.string().regex(/^cus_[A-Za-z0-9]+$/).max(200).safeParse(operation.originalRequest.providerCustomerRef);
        if (customer.success) customerReferences.add(customer.data);
      }
      if (customerReferences.size === 1) expectedCustomer = [...customerReferences][0];
    }
    return { ...subscriptionChargeScope(scope), subscriptionId: original.subscription.id,
      providerPlatformAccountId: scope.providerPlatformAccountId, providerScheduleApiVersion: scope.providerScheduleApiVersion,
      providerSubscriptionRef: input.providerSubscriptionRef, providerScheduleOperationId,
      // Expected customer comes from admitted immutable request lineage, never
      // from a contradictory response or a later CRM/current-method lookup.
      providerCustomerRef: expectedCustomer };
  },
});

registerSubscriptionProviderScopeResolver(async (provider, input) => {
  if (provider !== "stripe") return null;
  return resolveProviderWebhookScope.call({ ...input, provider }, { kind: "system" });
});
export default [resolveProviderWebhookScope];
