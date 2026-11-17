// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import type { ServiceContext } from "@/core/service";

const { boundOriginalCashRecovery } = vi.hoisted(() => ({
  boundOriginalCashRecovery: vi.fn(async () => { throw new Error("closure stop"); }),
}));
vi.mock("@/modules/invoicing/original-cash-recovery-current", () => ({ boundOriginalCashRecovery }));

import { createOriginalCashClosureShare, currentOriginalCashClosureShared } from "@/modules/invoicing/original-cash-closure-current";

describe("per-invocation original cash closure sharing", () => {
  it("reuses only the exact recovery and closure promise within one supplied share", async () => {
    const share = createOriginalCashClosureShare(), ctx = {} as ServiceContext;
    const first = currentOriginalCashClosureShared(ctx, "recovery", "closure", share);
    const second = currentOriginalCashClosureShared(ctx, "recovery", "closure", share);
    await expect(Promise.all([first, second])).rejects.toThrow("closure stop");
    expect(boundOriginalCashRecovery).toHaveBeenCalledTimes(1);
    expect(share.closures.size).toBe(1);

    await expect(currentOriginalCashClosureShared(ctx, "recovery", "other-closure", share)).rejects.toThrow("closure stop");
    expect(boundOriginalCashRecovery).toHaveBeenCalledTimes(2);
    await expect(currentOriginalCashClosureShared(ctx, "recovery", "closure")).rejects.toThrow("closure stop");
    expect(boundOriginalCashRecovery).toHaveBeenCalledTimes(3);
    expect(createOriginalCashClosureShare()).not.toBe(share);
  });
});
