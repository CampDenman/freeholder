// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { forgetLocalMerchantCallFinish, localMerchantCallFinish, merchantCallerLiveness, merchantPhysicalCaller, retainLocalMerchantCallFinish } from "@/modules/invoicing/merchant-physical-caller";

describe("physical merchant caller evidence", () => {
  it("keeps one actual process birth across repeated access without using age as absence", () => {
    const caller = merchantPhysicalCaller();
    expect(merchantPhysicalCaller()).toEqual(caller);
    expect(merchantCallerLiveness({ ...caller, startedAt: "1900-01-01T00:00:00Z" })).toBe(process.platform === "linux" ? "live" : "unobservable");
  });
  it("refuses to infer cross-host, missing-birth, or invalid-PID absence", () => {
    const caller = merchantPhysicalCaller();
    expect(merchantCallerLiveness({ ...caller, host: `${caller.host}-other` })).toBe("unobservable");
    expect(merchantCallerLiveness({ ...caller, startTicks: null })).toBe("unobservable");
    expect(merchantCallerLiveness({ ...caller, pid: -1 })).toBe("unobservable");
  });
  it.runIf(process.platform === "linux")("distinguishes an actual live child from its subsequently stopped original birth", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
    await once(child, "spawn");
    const stat = readFileSync(`/proc/${child.pid}/stat`, "utf8");
    const startTicks = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)[19]!;
    const caller = { ...merchantPhysicalCaller(), pid: child.pid!, startTicks };
    try {
      expect(merchantCallerLiveness(caller)).toBe("live");
      expect(merchantCallerLiveness({ ...caller, startTicks: `${BigInt(startTicks) + 1n}` })).toBe("absent");
    } finally {
      const ended = once(child, "exit"); child.kill("SIGTERM"); await ended;
    }
    expect(merchantCallerLiveness(caller)).toBe("absent");
  });
  it("retains only bounded provider resource ACKs, independently of successful money", () => {
    const id = crypto.randomUUID(), payment = crypto.randomUUID(), nonce = "private-completion-nonce";
    try {
      retainLocalMerchantCallFinish(id, payment, nonce, "returned", { providerRef: "cs_original", paymentRef: "pi_original", secret: "not retained" });
      expect(localMerchantCallFinish(id)).toEqual({ paymentId: payment, nonce, outcome: "returned", providerRef: "cs_original", paymentRef: "pi_original" });
      retainLocalMerchantCallFinish(id, payment, nonce, "threw");
      expect(localMerchantCallFinish(id)).toMatchObject({ outcome: "threw", providerRef: null, paymentRef: null });
    } finally { forgetLocalMerchantCallFinish(id); }
    expect(localMerchantCallFinish(id)).toBeUndefined();
  });
});
