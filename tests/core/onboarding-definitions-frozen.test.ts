// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Stored onboarding definitions are immutable per key@version: boot
// (syncOnboardingDefinitions) refuses a definition that differs from the row
// an earlier release stored, and the job runtime then never starts. CI runs
// on empty databases, so it cannot see that by itself; this test compares
// every guidance flow and demo scenario with the fingerprints released
// versions committed here, and fails when one changes without a new version.
//
// A new key@version is added with ONBOARDING_FREEZE_ADD=1; existing entries
// are never rewritten.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "@/core/runtime";
import { demoFixture, demoScenarios, onboardingGuidance } from "@/core/onboarding/registry";

const FILE = join(__dirname, "onboarding-definitions.frozen.json");

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
const fingerprint = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");

function current(): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const flow of onboardingGuidance()) {
    entries[`guidance:${flow.key}@${flow.version}`] = fingerprint({ titleKey: flow.titleKey, descriptionKey: flow.descriptionKey, audienceRoles: flow.audienceRoles, requiredCapabilities: flow.requiredCapabilities, steps: flow.steps, status: flow.status });
  }
  for (const s of demoScenarios()) {
    entries[`demo:${s.key}@${s.version}`] = fingerprint({
      titleKey: s.titleKey, descriptionKey: s.descriptionKey, preset: s.preset, requiredModules: s.requiredModules, requiredCapabilities: s.requiredCapabilities,
      fixtureManifest: s.fixtureContributions.map((r) => demoFixture(r.key, r.version)), defaultLocale: s.defaultLocale, supportedLocales: s.supportedLocales, tourFlowKey: s.tourFlowKey ?? null, status: s.status,
    });
  }
  return entries;
}

describe("stored onboarding definitions are immutable per version", () => {
  beforeAll(async () => { await ready(); }, 60_000);

  it("matches every released fingerprint, so a changed definition has a new version", () => {
    const frozen = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, string>;
    const now = current();
    const changed = Object.keys(now).filter((key) => key in frozen && frozen[key] !== now[key]);
    expect(changed, `These changed without a version increase; bump their version instead: ${changed.join(", ")}`).toEqual([]);
    const added = Object.keys(now).filter((key) => !(key in frozen));
    if (added.length && process.env.ONBOARDING_FREEZE_ADD === "1") {
      writeFileSync(FILE, `${JSON.stringify(Object.fromEntries(Object.entries({ ...frozen, ...Object.fromEntries(added.map((k) => [k, now[k]!])) }).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`);
      return;
    }
    expect(added, `New definitions: record them with ONBOARDING_FREEZE_ADD=1 pnpm vitest run ${"tests/core/onboarding-definitions-frozen.test.ts"}`).toEqual([]);
  });
});
