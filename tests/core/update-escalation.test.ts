// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { permits } from "@/core/service";
import { hiddenFromMcp } from "@/mcp/tools";
import updateServices from "@/core/update/service";
import {
  ESCALATION_HOURS,
  bandFor,
  decideEscalation,
  escalationMessage,
} from "@/core/update/escalation";
import type { MissingRelease } from "@/core/update/fork";

const NOW = new Date("2026-09-10T00:00:00.000Z");

function outstanding(cvss: number, hoursAgo: number, version = "0.1.1"): MissingRelease {
  return {
    version,
    severity: cvss >= 9 ? "critical" : cvss >= 7 ? "high" : cvss >= 4 ? "medium" : "low",
    cvss,
    notesUrl: "https://example.test/notes",
    publishedAt: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
  };
}

describe("the security escalation (C10.22)", () => {
  describe("severity sets the clock", () => {
    it("bands a score the way the notification will describe it", () => {
      expect(bandFor(9.8)).toBe("critical");
      expect(bandFor(8.1)).toBe("high");
      expect(bandFor(5.4)).toBe("medium");
      expect(bandFor(2.1)).toBe("low");
    });

    it("interrupts quickly for a critical release", () => {
      const decision = decideEscalation({
        missingSecurity: [outstanding(9.8, ESCALATION_HOURS.critical + 1)],
        now: NOW,
      });
      expect(decision.escalate).toBe(true);
      expect(decision.band).toBe("critical");
    });

    it("does not interrupt for a low-severity release on the same day", () => {
      // Treating a 2.1 like a 9.8 is how an owner learns to archive these
      // unread — at which point escalation is worse than silence, not better.
      const decision = decideEscalation({
        missingSecurity: [outstanding(2.1, 25)],
        now: NOW,
      });
      expect(decision.escalate).toBe(false);
      expect(decision.reason).toContain("not been outstanding long enough");
    });

    it("stays quiet when nothing is outstanding", () => {
      const decision = decideEscalation({ missingSecurity: [], now: NOW });
      expect(decision.escalate).toBe(false);
      expect(decision.idempotencyKey).toBeNull();
    });
  });

  describe("which release it names", () => {
    it("names the worst overdue release, not the oldest", () => {
      const decision = decideEscalation({
        missingSecurity: [
          outstanding(5.4, 200, "0.1.1"),
          outstanding(9.1, 30, "0.1.3"),
          outstanding(7.2, 100, "0.1.2"),
        ],
        now: NOW,
      });
      expect(decision.release?.version).toBe("0.1.3");
      expect(decision.band).toBe("critical");
    });

    it("ignores an unscored release entirely", () => {
      const decision = decideEscalation({
        missingSecurity: [
          { ...outstanding(9.8, 500), cvss: null, severity: "none" },
        ],
        now: NOW,
      });
      expect(decision.escalate).toBe(false);
    });
  });

  describe("not nagging, and not going quiet", () => {
    it("keeps one key per release per day, so an hourly job escalates once", () => {
      const first = decideEscalation({
        missingSecurity: [outstanding(9.8, 30)],
        now: NOW,
      });
      const laterSameDay = decideEscalation({
        missingSecurity: [outstanding(9.8, 30 + 6)],
        now: new Date(NOW.getTime() + 6 * 3_600_000),
      });
      expect(first.idempotencyKey).toBe(laterSameDay.idempotencyKey);
    });

    it("gives a newer release its own alarm rather than swallowing it", () => {
      const older = decideEscalation({
        missingSecurity: [outstanding(9.8, 30, "0.1.1")],
        now: NOW,
      });
      const newer = decideEscalation({
        missingSecurity: [outstanding(9.8, 30, "0.1.2")],
        now: NOW,
      });
      expect(older.idempotencyKey).not.toBe(newer.idempotencyKey);
    });

    it("still escalates while the owner has paused automatic updates", () => {
      // §39.6 lets an owner turn automatic applying off. It does not let the
      // platform stop saying they are exposed — that sentence is what made
      // pausing a safe thing to offer.
      const decision = decideEscalation({
        missingSecurity: [outstanding(9.8, 30)],
        now: NOW,
        paused: true,
      });
      expect(decision.escalate).toBe(true);
      expect(decision.reason).toContain("paused");
    });
  });

  it("says how long, in units a person reads", () => {
    const decision = decideEscalation({
      missingSecurity: [outstanding(8.1, 96)],
      now: NOW,
    });
    const message = escalationMessage(decision);
    expect(message.title).toBe("Security update 0.1.1 — CVSS 8.1");
    expect(message.body).toContain("4 days");
    expect(message.body).toContain("freeholder update --apply");
  });

  describe("MCP: the same capability, with read and apply as separate scopes", () => {
    const named = (name: string) =>
      updateServices.find((service) => service.def.name === name)!;

    it("offers the update services as tools", () => {
      for (const name of [
        "platform.updateStatus",
        "platform.checkUpdates",
        "platform.preflightUpdate",
        "platform.applyUpdate",
        "platform.rollbackUpdate",
      ]) {
        expect(named(name), name).toBeDefined();
        expect(hiddenFromMcp(named(name)), name).toBe(false);
      }
    });

    it("lets a status scope read without letting it cut a site over", () => {
      // §39.10: "Applying an update is a separate scope from reading its
      // status." A monitoring key must not be able to apply.
      const reader = {
        kind: "agent" as const,
        keyName: "monitor",
        scopes: ["platform.updateStatus"],
      };
      expect(permits(reader, "scoped", "platform.updateStatus", "query")).toBe(true);
      expect(permits(reader, "scoped", "platform.applyUpdate")).toBe(false);
      expect(permits(reader, "scoped", "platform.rollbackUpdate")).toBe(false);
    });

    it("still admits a key deliberately scoped to apply", () => {
      const applier = {
        kind: "agent" as const,
        keyName: "deployer",
        scopes: ["platform.applyUpdate"],
      };
      expect(permits(applier, "scoped", "platform.applyUpdate")).toBe(true);
      expect(permits(applier, "scoped", "platform.saveUpdatePolicy")).toBe(false);
    });
  });
});
