// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.15: two demo paths exist on purpose. This test names their callers so
// neither is mistaken for a scaffold to delete.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("demo paths (C11.15)", () => {
  it("keeps demo.install as the empty-instance seed with real callers", () => {
    const seed = read("src/modules/seed/service.ts");
    const boot = read("src/modules/seed/boot.ts");
    const a11y = read("tests/browser/accessibility.spec.ts");
    const tests = read("tests/core/seed-demo.test.ts");
    expect(seed).toContain('name: "demo.install"');
    expect(boot).toContain("installDemo.call");
    expect(a11y).toContain("/demo.install");
    expect(tests).toContain("installDemo.call");
  });

  it("keeps core/demo as the tracked /admin/demos orchestrator", () => {
    const actions = read("app/(admin)/demo-actions.ts");
    const service = read("src/core/demo/service.ts");
    const tests = read("tests/core/demo-scenarios.test.ts");
    expect(actions).toContain("loadDemoScenario.call");
    expect(actions).toContain("purgeDemoScenario.call");
    expect(service).toContain("demoFixture(");
    expect(tests).toContain("loadDemoScenario.call");
  });

  it("reaches fixture load/purge/verify services through the orchestrator registry", () => {
    const onboarding = read("src/core/onboarding/index.ts");
    const fixtures = read("src/core/demo/fixtures.ts");
    expect(onboarding).toContain('loadService: "core.loadDemoContacts"');
    expect(onboarding).toContain('purgeService: "core.purgeDemoContacts"');
    expect(onboarding).toContain('verifyService: "core.verifyDemoContacts"');
    expect(fixtures).toContain('name: "core.loadDemoContacts"');
  });

  it("keeps seed.installPreset as the business-preset installer", () => {
    const preset = read("src/modules/seed/preset-install.ts");
    const tests = read("tests/core/templates.test.ts");
    expect(preset).toContain('name: "seed.installPreset"');
    expect(tests).toContain("installPreset");
  });
});
