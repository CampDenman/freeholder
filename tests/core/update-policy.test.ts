// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_UPDATE_POLICY,
  inUpdateWindow,
  requiresApproval,
  shouldAutoApply,
} from "@/core/update/policy";
import { evaluateUpdatePolicy, getUpdatePolicy, saveUpdatePolicy } from "@/core/update/service";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe("update policy (C10.08)", () => {
  const window = { days: ["tue", "wed", "thu"], start: "03:00" };
  const tuesdayThreePdt = new Date("2026-09-08T10:00:00.000Z");
  const mondayThreePdt = new Date("2026-09-07T10:00:00.000Z");

  it("uses a night window in the business timezone and skips outside it", () => {
    expect(inUpdateWindow(tuesdayThreePdt, "America/Vancouver", window)).toBe(true);
    expect(inUpdateWindow(mondayThreePdt, "America/Vancouver", window)).toBe(false);
  });

  it("auto-applies security releases and requires approval for feature updates", () => {
    const policy = { ...DEFAULT_UPDATE_POLICY };
    expect(shouldAutoApply(policy, { channel: "security" }, tuesdayThreePdt, "America/Vancouver")).toBe(true);
    expect(shouldAutoApply(policy, { channel: "stable" }, tuesdayThreePdt, "America/Vancouver")).toBe(false);
    expect(requiresApproval({ ...policy, channel: "stable" }, { channel: "stable" })).toBe(true);
    expect(requiresApproval(policy, { channel: "security" })).toBe(false);
    expect(shouldAutoApply({ ...policy, pausedUntil: new Date("2026-09-09T00:00:00.000Z") }, { channel: "security" }, tuesdayThreePdt, "America/Vancouver")).toBe(false);
    expect(shouldAutoApply({ ...policy, channel: "off" }, { channel: "security" }, tuesdayThreePdt, "America/Vancouver")).toBe(false);
  });
});

describe.runIf(hasDatabase)("platform.getUpdatePolicy (C10.08)", { timeout: 60_000 }, () => {
  beforeEach(truncateSpine, 30_000);
  afterAll(closeDb);

  it("defaults to security-auto and lets an owner change the window", async () => {
    const policy = await getUpdatePolicy.call({}, OWNER);
    expect(policy.channel).toBe("security");
    expect(policy.applyLevel).toBe("security");
    expect(policy.drain).toBe(true);
    expect(policy.keepSnapshots).toBe(5);
    const saved = await saveUpdatePolicy.call(
      {
        channel: "stable",
        applyLevel: "none",
        window: { days: ["sat"], start: "22:00" },
        drain: true,
        notifyChannels: ["email"],
        keepSnapshots: 3,
      },
      OWNER,
    );
    expect(saved.channel).toBe("stable");
    expect(saved.applyLevel).toBe("none");
    const evaluated = await evaluateUpdatePolicy.call(
      { channel: "stable", now: new Date("2026-09-08T10:00:00.000Z"), timezone: "UTC" },
      OWNER,
    );
    expect(evaluated.requiresApproval).toBe(true);
    expect(evaluated.autoApply).toBe(false);
    const denied = await failure(getUpdatePolicy.call({}, ANONYMOUS));
    expect(denied.code).toBe("permission");
  });
});
