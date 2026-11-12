// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: no-subscription is not proof that a seller's payment caller stopped.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceContext } from "@/core/service";
import type * as CoreServices from "@/core/service";

const recovery = vi.hoisted(() => ({ available: true, service: {}, call: vi.fn() }));
vi.mock("@/core/service", async importOriginal => ({
  ...await importOriginal<typeof CoreServices>(),
  getService: (name: string) => name === "invoicing.merchantTaxPaymentDebt" && recovery.available ? recovery.service : undefined,
}));
import { merchantTaxScheduleState } from "@/modules/subscriptions/merchant-tax-quiescence";

describe("original merchant financial debt before schedule erasure", () => {
  beforeEach(() => { recovery.available = true; recovery.call.mockReset(); });
  function context() {
    const query: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["from", "innerJoin", "leftJoin", "where", "orderBy"]) query[method] = vi.fn(() => query);
    query.limit = vi.fn(async () => []);
    const select = vi.fn(() => query);
    return { ctx: { tx: { select }, callAsSystem: recovery.call } as unknown as ServiceContext, select };
  }
  const profileId = "00000000-0000-4000-8000-000000000001";
  it("keeps missing original payment recovery unavailable rather than claiming no schedules", async () => {
    recovery.available = false;
    const { ctx, select } = context();
    expect(await merchantTaxScheduleState(ctx, profileId)).toEqual({ safe: false, external: true });
    expect(select).not.toHaveBeenCalled();
  });
  it.each([{ pending: true, incomplete: false }, { pending: false, incomplete: true }])("blocks unresolved original financial callers: %j", async debt => {
    recovery.call.mockResolvedValue({ ...debt, hasHistory: true, paymentIds: [] });
    const { ctx, select } = context();
    expect(await merchantTaxScheduleState(ctx, profileId)).toEqual({ safe: false, external: true });
    expect(recovery.call).toHaveBeenCalledWith(recovery.service, { profileId });
    expect(select).not.toHaveBeenCalled();
  });
  it("retains settled original financial history without fabricating a provider subscription", async () => {
    recovery.call.mockResolvedValue({ pending: false, incomplete: false, hasHistory: true, paymentIds: [profileId] });
    const { ctx, select } = context();
    expect(await merchantTaxScheduleState(ctx, profileId)).toEqual({ safe: true, external: true });
    expect(select).toHaveBeenCalledTimes(1);
  });
  it("preserves the genuine zero-dependency path after the financial inventory proves empty", async () => {
    recovery.call.mockResolvedValue({ pending: false, incomplete: false, hasHistory: false, paymentIds: [] });
    const { ctx } = context();
    expect(await merchantTaxScheduleState(ctx, profileId)).toEqual({ safe: true, external: false });
  });
});
