// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, it } from "vitest";
import { updateStatus, type CachedRelease } from "@/core/update/catalog";
import { listAvailableReleases, updateStatus as updateStatusService } from "@/core/update/service";
import { ANONYMOUS, closeDb, failure, hasDatabase } from "../helpers/spine";

function cached(overrides: Partial<CachedRelease>): CachedRelease {
  return {
    version: "0.2.0",
    channel: "stable",
    digest: `sha256:${"a".repeat(64)}`,
    severity: "none",
    cvss: null,
    schemaBreaking: false,
    minFromVersion: "0.1.0",
    pluginApi: "0.1.0",
    notesUrl: "https://example.test/notes",
    publishedAt: new Date("2026-09-01T00:00:00.000Z"),
    verified: true,
    ...overrides,
  };
}

const CHECKED = new Date("2026-09-07T00:00:00.000Z");

describe("update read model (C10.11)", () => {
  describe("the status line that is never ambiguous", () => {
    it("does not say up to date when it has never checked", () => {
      const status = updateStatus({
        currentVersion: "0.1.0",
        channel: "stable",
        cached: [],
        lastCheckedAt: null,
        checksEnabled: true,
      });
      // Silence must not be indistinguishable from safety (§39.10).
      expect(status.posture).toBe("unknown");
      expect(status.sentence).toContain("does not know whether it is current");
      expect(status.urgent).toBe(false);
    });

    it("says so plainly when checks are switched off", () => {
      const status = updateStatus({
        currentVersion: "0.1.0",
        channel: "stable",
        cached: [],
        lastCheckedAt: null,
        checksEnabled: false,
      });
      expect(status.posture).toBe("unknown");
      expect(status.sentence).toContain("Update checks are off");
    });

    it("says up to date only when nothing newer is offered", () => {
      const status = updateStatus({
        currentVersion: "0.2.0",
        channel: "stable",
        cached: [cached({ version: "0.2.0" }), cached({ version: "0.1.0" })],
        lastCheckedAt: CHECKED,
        checksEnabled: true,
      });
      expect(status.posture).toBe("current");
      expect(status.sentence).toBe("Up to date");
    });

    it("names the newest version when a feature release is waiting", () => {
      const status = updateStatus({
        currentVersion: "0.1.0",
        channel: "stable",
        cached: [cached({ version: "0.2.0" }), cached({ version: "0.3.0" })],
        lastCheckedAt: CHECKED,
        checksEnabled: true,
      });
      expect(status.posture).toBe("behind");
      expect(status.sentence).toBe("Update available — 0.3.0");
      expect(status.urgent).toBe(false);
    });

    it("counts security releases and shows the worst score, in the danger colour", () => {
      const status = updateStatus({
        currentVersion: "0.1.0",
        channel: "stable",
        cached: [
          cached({ version: "0.1.1", channel: "security", cvss: 8.1, severity: "high" }),
          cached({ version: "0.1.2", channel: "security", cvss: 5.4, severity: "medium" }),
          cached({ version: "0.2.0" }),
        ],
        lastCheckedAt: CHECKED,
        checksEnabled: true,
      });
      expect(status.posture).toBe("behind-security");
      expect(status.sentence).toBe("2 security releases behind — CVSS 8.1");
      expect(status.urgent).toBe(true);
      expect(status.worstCvss).toBe(8.1);
    });

    it("does not count a release this channel would never be offered", () => {
      const status = updateStatus({
        currentVersion: "0.1.0",
        channel: "security",
        cached: [cached({ version: "0.9.0", channel: "edge" })],
        lastCheckedAt: CHECKED,
        checksEnabled: true,
      });
      expect(status.posture).toBe("current");
      expect(status.missing).toEqual([]);
    });

    it("treats an unscored release as news rather than exposure", () => {
      const status = updateStatus({
        currentVersion: "0.1.0",
        channel: "stable",
        cached: [cached({ version: "0.2.0", cvss: null, severity: "none" })],
        lastCheckedAt: CHECKED,
        checksEnabled: true,
      });
      expect(status.posture).toBe("behind");
      expect(status.missingSecurity).toEqual([]);
    });
  });

  describe("the rollback horizon (§39.11)", () => {
    it("names the breaking release an image swap can no longer reach past", () => {
      const status = updateStatus({
        currentVersion: "0.4.0",
        channel: "stable",
        cached: [
          cached({ version: "0.2.0", schemaBreaking: true }),
          cached({ version: "0.3.0", schemaBreaking: true }),
          cached({ version: "0.4.0" }),
        ],
        lastCheckedAt: CHECKED,
        checksEnabled: true,
      });
      expect(status.earliestReachableVersion).toBe("0.3.0");
    });

    it("has no horizon when nothing has contracted the schema", () => {
      const status = updateStatus({
        currentVersion: "0.4.0",
        channel: "stable",
        cached: [cached({ version: "0.3.0" }), cached({ version: "0.4.0" })],
        lastCheckedAt: CHECKED,
        checksEnabled: true,
      });
      expect(status.earliestReachableVersion).toBeNull();
    });

    it("ignores a breaking release the instance has not reached yet", () => {
      const status = updateStatus({
        currentVersion: "0.2.0",
        channel: "stable",
        cached: [cached({ version: "0.5.0", schemaBreaking: true })],
        lastCheckedAt: CHECKED,
        checksEnabled: true,
      });
      expect(status.earliestReachableVersion).toBeNull();
    });
  });

  describe.runIf(hasDatabase)("through the services", () => {
    afterAll(async () => {
      await closeDb();
    });

    it("refuses an anonymous caller", async () => {
      expect((await failure(updateStatusService.call({}, ANONYMOUS))).code).toBe("permission");
      expect((await failure(listAvailableReleases.call({}, ANONYMOUS))).code).toBe("permission");
    });
  });
});
