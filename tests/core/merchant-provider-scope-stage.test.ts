// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.resetModules());
describe("original subscription webhook scope phase", () => {
  it("keeps legacy lookup optional and refuses tagged new schedules without their source resolver", async () => {
    const { resolveSubscriptionProviderScope } = await import("@/modules/invoicing/merchant-provider-stage");
    const base = { providerSubscriptionRef: "sub_original", metadata: { freeholder_subscription_id: crypto.randomUUID() } };
    expect(await resolveSubscriptionProviderScope("stripe", base)).toBeNull();
    await expect(resolveSubscriptionProviderScope("stripe", { ...base, metadata: { ...base.metadata, freeholder_subscription_scope_version: "1" } })).rejects.toMatchObject({ code: "conflict" });
    await expect(resolveSubscriptionProviderScope("stripe", { ...base, metadata: { ...base.metadata, freeholder_subscription_operation_id: crypto.randomUUID() } })).rejects.toMatchObject({ code: "conflict" });
  });
  it("passes authenticated source facts and provider namespace to the committed lookup without rewriting them", async () => {
    const { registerSubscriptionProviderScopeResolver, resolveSubscriptionProviderScope } = await import("@/modules/invoicing/merchant-provider-stage");
    const input = { providerSubscriptionRef: "sub_original", providerInvoiceRef: "in_original", providerAccountId: "acct_original", metadata: { freeholder_subscription_scope_version: "1", freeholder_subscription_operation_id: crypto.randomUUID() } };
    const result = { subscriptionId: crypto.randomUUID(), providerSubscriptionRef: "sub_original", providerScheduleApiVersion: "2026-10-28.endive" as const, providerPlatformAccountId: "acct_platform", providerAccountId: "acct_original", providerScheduleOperationId: input.metadata.freeholder_subscription_operation_id };
    const resolve = vi.fn().mockResolvedValue(result);
    registerSubscriptionProviderScopeResolver(resolve);
    expect(await resolveSubscriptionProviderScope("stripe", input)).toBe(result);
    expect(resolve).toHaveBeenCalledExactlyOnceWith("stripe", input);
  });
});
