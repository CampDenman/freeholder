// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaymentProviderEvent } from "@/adapters/payments";

afterEach(() => vi.resetModules());
describe("original subscription webhook scope phase", () => {
  it("requires the actual committed cash observer before original-cohort recovery reads", async () => {
    const { assertSubscriptionProviderCaptureReady, registerSubscriptionProviderChargeObserver } = await import("@/modules/invoicing/merchant-provider-stage");
    expect(() => assertSubscriptionProviderCaptureReady()).toThrow(/cash receipt phase/i);
    registerSubscriptionProviderChargeObserver(async (_provider, event) => event);
    expect(() => assertSubscriptionProviderCaptureReady()).not.toThrow();
  });
  it("keeps legacy lookup optional and refuses tagged new schedules without their source resolver", async () => {
    const { resolveSubscriptionProviderScope } = await import("@/modules/invoicing/merchant-provider-stage");
    const base = { providerSubscriptionRef: "sub_original", metadata: { freeholder_subscription_id: crypto.randomUUID() } };
    expect(await resolveSubscriptionProviderScope("stripe", base)).toBeNull();
    await expect(resolveSubscriptionProviderScope("stripe", { ...base, metadata: { ...base.metadata, freeholder_subscription_scope_version: "1" } })).rejects.toMatchObject({ code: "conflict" });
    await expect(resolveSubscriptionProviderScope("stripe", { ...base, metadata: { ...base.metadata, freeholder_subscription_operation_id: crypto.randomUUID() } })).rejects.toMatchObject({ code: "conflict" });
  });
  it("passes authenticated source facts and provider namespace to the committed lookup without rewriting them", async () => {
    const { registerSubscriptionProviderScopeResolver, registerSubscriptionProviderChargeObserver, resolveSubscriptionProviderScope } = await import("@/modules/invoicing/merchant-provider-stage");
    const input = { providerSubscriptionRef: "sub_original", providerInvoiceRef: "in_original", providerAccountId: "acct_original", metadata: { freeholder_subscription_scope_version: "1", freeholder_subscription_operation_id: crypto.randomUUID() } };
    const result = { subscriptionId: crypto.randomUUID(), providerSubscriptionRef: "sub_original", providerScheduleApiVersion: "2026-10-28.endive" as const, providerPlatformAccountId: "acct_platform", providerAccountId: "acct_original", providerScheduleOperationId: input.metadata.freeholder_subscription_operation_id };
    const resolve = vi.fn().mockResolvedValue(result);
    registerSubscriptionProviderScopeResolver(resolve);
    await expect(resolveSubscriptionProviderScope("stripe", input)).rejects.toMatchObject({ code: "conflict" });
    registerSubscriptionProviderChargeObserver(async (_provider, event) => event);
    expect(await resolveSubscriptionProviderScope("stripe", input)).toBe(result);
    expect(resolve).toHaveBeenLastCalledWith("stripe", input);
  });
  it("commits a positive observation through the capture-only phase and refuses a missing phase", async () => {
    const { registerSubscriptionProviderChargeObserver, observeSubscriptionProviderCharge } = await import("@/modules/invoicing/merchant-provider-stage");
    const event = { id: "evt_originalCash", kind: "subscription_period_paid" as const, providerRef: "sub_original", providerPlatformAccountId: "acct_platform", amountMinor: 1234, currency: "CAD", occurredAt: new Date().toISOString() };
    await expect(observeSubscriptionProviderCharge("stripe", event)).rejects.toMatchObject({ code: "conflict" });
    const retain = vi.fn(async (_provider: string, observed: PaymentProviderEvent) => observed);
    registerSubscriptionProviderChargeObserver(retain);
    expect(await observeSubscriptionProviderCharge("stripe", event)).toBe(event);
    expect(retain).toHaveBeenCalledExactlyOnceWith("stripe", event);
  });
});
