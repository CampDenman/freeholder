// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The update screen (C10.20). These assertions are about the screen existing,
// being reachable, and saying the right thing in every locale — the parts that
// break silently. Its behaviour in a real browser is the accessibility sweep.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const PAGE = "app/(admin)/admin/updates/page.tsx";
const NAV = "app/(admin)/admin/AdminNav.tsx";
const LAYOUT = "app/(admin)/admin/layout.tsx";
const ACTIONS = "app/(admin)/actions.ts";
const LOCALES = ["en", "es", "fr"] as const;

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function locale(name: string): Record<string, string> {
  return JSON.parse(readFileSync(`locales/${name}.json`, "utf8")) as Record<string, string>;
}

describe("the update screen (C10.20)", () => {
  it("is reachable from the admin nav and labelled from the catalog", () => {
    expect(read(NAV)).toContain('href: "/admin/updates"');
    expect(read(LAYOUT)).toContain('updates: t("updates.title")');
  });

  it("requires the platform grant rather than any signed-in session", () => {
    expect(read(PAGE)).toContain('requireStaffActor("platform")');
  });

  describe("discharges the F04 deferred by C10.01–C10.11", () => {
    // Every one of those items recorded its human surface as a Doctor check
    // "not a new admin screen (C10.11)". If one of these disappears from the
    // page, that debt has quietly come back.
    const owed: [string, string][] = [
      ["the status line", "status.sentence"],
      ["the signed feed", "updates.feed"],
      ["check now (C10.04)", 'intent="check"'],
      ["preflight (C10.05)", 'intent="preflight"'],
      ["apply, the one button (C10.06)", 'intent="apply"'],
      ["run history (C10.06)", "updates.history"],
      ["schema-breaking (C10.07)", "updates.schemaBreaking"],
      ["the policy editor (C10.08)", 'intent="savePolicy"'],
      ["pause (C10.08)", "updates.action.pause"],
      ["the fork lane (C10.09)", 'intent="forkUpdate"'],
      ["per-target strategy (C10.10)", "updates.targets"],
      ["the rollback horizon (C10.11)", "earliestReachableVersion"],
    ];
    for (const [what, marker] of owed) {
      it(`shows ${what}`, () => {
        expect(read(PAGE)).toContain(marker);
      });
    }
  });

  it("warns when no deploy target is declared, because a no-op update looks like success", () => {
    expect(read(PAGE)).toContain("updates.noTargetWarning");
    for (const name of LOCALES) {
      expect(locale(name)["updates.noTargetWarning"]).toBeTruthy();
    }
  });

  it("confirms before cutting a live site over", () => {
    expect(read(PAGE)).toContain("updates.applyConfirm");
    expect(locale("en")["updates.applyConfirm"]).toContain("{version}");
  });

  it("routes every action through a service rather than the database", () => {
    const actions = read(ACTIONS);
    expect(actions).toContain("updateControlAction");
    for (const service of [
      "checkUpdates",
      "preflightUpdate",
      "applyUpdate",
      "saveUpdatePolicy",
      "openForkUpdate",
    ]) {
      expect(actions).toContain(service);
    }
  });

  it("translates every string it renders, in all three locales", () => {
    const page = read(PAGE);
    const keys = [...page.matchAll(/t\(\s*["'`](updates\.[\w.]+)["'`]/g)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(20);
    for (const name of LOCALES) {
      const strings = locale(name);
      const missing = [...new Set(keys)].filter((key) => !strings[key]);
      expect(missing, `${name} is missing`).toEqual([]);
    }
  });

  it("uses semantic colour tokens only, so it ships in light and dark", () => {
    const page = read(PAGE);
    // A literal hex or a raw Tailwind palette colour here would be a colour
    // that only works on one ground, which the token gate forbids repo-wide.
    expect(page).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(page).not.toMatch(/\b(?:text|bg|border)-(?:red|green|blue|slate|gray|zinc)-\d{3}\b/);
  });
});
