// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  CHECK_SLOT_COUNT,
  isCheckSlot,
  jitterSlot,
  runScheduledUpdateCheck,
  runUpdateCheck,
  UPDATE_CHECK_HEADERS,
} from "@/core/update/check";
import { checkUpdates, updateCheckPolicy } from "@/core/update/service";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe("daily update check (C10.04)", () => {
  it("spreads instances across 15-minute UTC slots", () => {
    expect(jitterSlot("https://a.example")).toBeGreaterThanOrEqual(0);
    expect(jitterSlot("https://a.example")).toBeLessThan(CHECK_SLOT_COUNT);
    expect(jitterSlot("https://a.example")).toBe(jitterSlot("https://a.example"));
    const now = new Date(Date.UTC(2026, 8, 7, 0, 0, 0));
    const seed = "https://a.example";
    const slot = jitterSlot(seed);
    const inSlot = new Date(now.getTime() + slot * 15 * 60 * 1000);
    expect(isCheckSlot(inSlot, seed)).toBe(true);
    expect(isCheckSlot(new Date(inSlot.getTime() + 15 * 60 * 1000), seed)).toBe(false);
  });

  it("GETs a static file with no instance identifier", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    await runUpdateCheck({
      enabled: true,
      feedUrl: "https://github.com/CampDenman/freeholder/releases/latest/download/releases.json",
      fetchImpl: async (url, init) => {
        seen.push({ url, headers: init.headers });
        throw new Error("stop after observing the request");
      },
    }).catch((error: unknown) => {
      if (!(error instanceof Error) || !error.message.includes("stop after observing")) throw error;
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(
      "https://github.com/CampDenman/freeholder/releases/latest/download/releases.json",
    );
    expect(seen[0]?.url).not.toMatch(/instance|uuid|hostname|app_url/i);
    expect(JSON.stringify(seen[0]?.headers)).not.toMatch(/localhost|0\.1\.0|uuid/i);
    expect(seen[0]?.headers).toEqual({ ...UPDATE_CHECK_HEADERS });
  });

  it("does not fetch when checks are off or when this is not the instance's slot", async () => {
    let fetched = 0;
    const fetchImpl = async () => {
      fetched += 1;
      return { ok: true, status: 200, text: async () => "{}" };
    };
    expect(await runUpdateCheck({ enabled: false, feedUrl: "https://example.com/releases.json", fetchImpl })).toEqual({
      checked: false,
      reason: "off",
    });
    expect(fetched).toBe(0);
    const result = await runScheduledUpdateCheck(new Date(Date.UTC(2026, 8, 7, 0, 0, 0)), fetchImpl);
    if (result.checked === false && result.reason === "slot") {
      expect(fetched).toBe(0);
    }
  });
});

describe.runIf(hasDatabase)("platform.updateCheckPolicy (C10.04)", { timeout: 60_000 }, () => {
  beforeEach(truncateSpine, 30_000);
  afterAll(closeDb);

  it("says reporting does not exist and refuses anonymous callers", async () => {
    const policy = await updateCheckPolicy.call({}, OWNER);
    expect(policy.reports).toBe(false);
    expect(policy.feedUrl).toMatch(/^https:\/\//);
    const denied = await failure(updateCheckPolicy.call({}, ANONYMOUS));
    expect(denied.code).toBe("permission");
    const checkDenied = await failure(checkUpdates.call({}, ANONYMOUS));
    expect(checkDenied.code).toBe("permission");
  });
});
