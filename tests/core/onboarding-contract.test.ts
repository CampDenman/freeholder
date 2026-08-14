// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Plugin-facing conformance: malformed contributions fail before fixture work.
import { afterEach, describe, expect, it } from "vitest";
import {
  registerOnboardingModule,
  resetOnboardingRegistryForTests,
  validateOnboardingRegistry,
} from "@/core/onboarding/registry";

const base = () => ({
  targets: [
    {
      key: "hostile.screen",
      href: "/admin/hostile",
      selector: '[data-demo-target="record"]',
      requiredModules: ["hostile"],
      requiredCapabilities: ["hostile:view"],
    },
  ],
  guidance: [],
  fixtures: [
    {
      key: "hostile.fixture",
      version: 1,
      scenarioKeys: ["hostile.scenario"],
      dependsOn: [],
      requiredModules: ["hostile"],
      requiredCapabilities: ["hostile:view"],
      localeVariants: ["en"],
      records: [{ key: "record", subjectType: "hostile_record" }],
      expectedOutcomes: [
        {
          key: "hostile.visible",
          labelKey: "hostile.visible",
          targetKey: "hostile.screen",
        },
      ],
      loadService: "hostile.loadFixture",
      purgeService: "hostile.purgeFixture",
      verifyService: "hostile.verifyFixture",
    },
  ],
  scenarios: [
    {
      key: "hostile.scenario",
      version: 1,
      titleKey: "hostile.title",
      descriptionKey: "hostile.description",
      preset: "test",
      requiredModules: ["hostile"],
      requiredCapabilities: ["hostile:manage"],
      fixtureContributions: [{ key: "hostile.fixture", version: 1 }],
      defaultLocale: "en",
      supportedLocales: ["en"],
      status: "active" as const,
    },
  ],
});

const services = [
  "hostile.loadFixture",
  "hostile.purgeFixture",
  "hostile.verifyFixture",
];

function validate(
  contribution: ReturnType<typeof base>,
  over: { modules?: string[]; services?: string[]; targets?: string[] } = {},
) {
  registerOnboardingModule("hostile", contribution);
  validateOnboardingRegistry({
    installedModules: over.modules ?? ["hostile"],
    registeredServices: over.services ?? services,
    availableTargets:
      over.targets ?? ['/admin/hostile[data-demo-target="record"]'],
  });
}

afterEach(() => resetOnboardingRegistryForTests());

describe("onboarding contribution conformance", () => {
  it("accepts a complete, version-pinned and purgeable plugin contribution", () => {
    expect(() => validate(base())).not.toThrow();
  });

  it("accepts the same manifest on a repeated boot but rejects changed meaning", () => {
    const contribution = base();
    registerOnboardingModule("hostile", contribution);
    expect(() =>
      registerOnboardingModule("hostile", contribution),
    ).not.toThrow();
    const changed = base();
    changed.targets[0]!.href = "/admin/changed";
    expect(() => registerOnboardingModule("hostile", changed)).toThrow(
      /already contributed/,
    );
  });

  it("rejects hostile fixtures with missing dependencies or cleanup", () => {
    expect(() => validate(base(), { modules: [] })).toThrow(/missing module/);
    resetOnboardingRegistryForTests();
    expect(() =>
      validate(base(), {
        services: ["hostile.loadFixture", "hostile.verifyFixture"],
      }),
    ).toThrow(/missing handler service "hostile.purgeFixture"/);
  });

  it("rejects stale targets and capability-incomplete scenarios", () => {
    expect(() => validate(base(), { targets: ["/admin/hostile"] })).toThrow(
      /stale or missing/,
    );
    resetOnboardingRegistryForTests();
    const contribution = base();
    contribution.scenarios[0]!.requiredCapabilities = ["demo:manage"];
    expect(() => validate(contribution)).toThrow(/does not declare every capability/);
  });

  it("rejects undeclared targets, unpinned fixtures and foreign namespaces", () => {
    const missingTarget = base();
    missingTarget.fixtures[0]!.expectedOutcomes[0]!.targetKey = "hostile.gone";
    expect(() => validate(missingTarget)).toThrow(/names missing target/);
    resetOnboardingRegistryForTests();
    const missingFixture = base();
    missingFixture.scenarios[0]!.fixtureContributions[0]!.version = 2;
    expect(() => validate(missingFixture)).toThrow(/missing fixture "hostile.fixture@2"/);
    resetOnboardingRegistryForTests();
    const foreign = base();
    foreign.fixtures[0]!.key = "other.fixture";
    expect(() => validate(foreign)).toThrow(/outside its namespace/);
  });
});
