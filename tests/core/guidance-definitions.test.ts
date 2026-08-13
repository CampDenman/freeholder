// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Static contract for the shipped role/capability curriculum and its additive
// migration seed. These tests run even when no disposable Postgres is present.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CORE_GUIDANCE_FLOWS,
  guidanceFlowDefinitionSchema,
} from "@/core/guidance/definitions";
import {
  actorHasGuidanceCapability,
  eligibleGuidanceSteps,
  isGuidanceFlowEligible,
} from "@/core/guidance/service";
import { DEFAULT_ROLES, type DefaultRole } from "@/core/roles/defaults";
import type { Actor } from "@/core/service";

function actorFor(role: DefaultRole): Extract<Actor, { kind: "user" }> {
  return {
    kind: "user",
    userId: crypto.randomUUID(),
    role: role.key,
    grants: role.grants,
  };
}

const SHIPPED = [
  "owner",
  "administrator",
  "editor",
  "bookkeeper",
  "service-provider",
  "customer",
] as const;

describe("core guidance definitions", () => {
  it("gives every shipped role a preferred, usable first-win flow", () => {
    for (const roleKey of SHIPPED) {
      const role = DEFAULT_ROLES.find((candidate) => candidate.key === roleKey)!;
      const actor = actorFor(role);
      const preferred = CORE_GUIDANCE_FLOWS.filter(
        (flow) =>
          flow.audienceRoles.includes(roleKey) &&
          isGuidanceFlowEligible(actor, flow),
      );
      expect(preferred, `${roleKey} needs one preferred flow`).toHaveLength(1);
      const steps = eligibleGuidanceSteps(actor, preferred[0]!);
      expect(steps.length, `${roleKey} needs at least one usable task`).toBeGreaterThan(0);
      for (const step of steps) {
        expect(
          step.requiredCapabilities.every((capability) =>
            actorHasGuidanceCapability(actor, capability),
          ),
          `${roleKey} was shown forbidden step ${step.key}`,
        ).toBe(true);
      }
    }
  });

  it("uses capabilities for custom roles and removes every forbidden control", () => {
    const custom: Extract<Actor, { kind: "user" }> = {
      kind: "user",
      userId: crypto.randomUUID(),
      role: "site-writer",
      grants: [
        { module: "admin", access: "view" },
        { module: "cms", access: "manage" },
      ],
    };
    const editor = CORE_GUIDANCE_FLOWS.find(
      (flow) => flow.key === "core.editor-first-win",
    )!;
    expect(isGuidanceFlowEligible(custom, editor)).toBe(true);
    expect(eligibleGuidanceSteps(custom, editor).map((step) => step.key)).toEqual([
      "publish-page",
    ]);

    const customer = actorFor(
      DEFAULT_ROLES.find((role) => role.key === "customer")!,
    );
    const customerFlows = CORE_GUIDANCE_FLOWS.filter((flow) =>
      isGuidanceFlowEligible(customer, flow),
    );
    expect(customerFlows.map((flow) => flow.key)).toEqual([
      "core.customer-first-win",
    ]);
    expect(
      customerFlows.flatMap((flow) => eligibleGuidanceSteps(customer, flow))
        .every((step) => step.href.startsWith("/portal/")),
    ).toBe(true);
  });

  it("keeps every definition versioned, unique, internal and outcome-based", () => {
    const identities = new Set<string>();
    for (const raw of CORE_GUIDANCE_FLOWS) {
      const flow = guidanceFlowDefinitionSchema.parse(raw);
      const identity = `${flow.key}@${flow.version}`;
      expect(identities.has(identity), identity).toBe(false);
      identities.add(identity);
      for (const step of flow.steps) {
        expect(step.href).toMatch(/^\/(?!\/)/);
        expect(step.outcome.type).not.toBe("click");
      }
    }
  });
});

function sqlArray(value: string): string[] {
  return [...value.matchAll(/'([^']*)'/g)].map((match) => match[1]!);
}

describe("the guidance migration seed", () => {
  it("matches the executable TypeScript definitions exactly", () => {
    const migration = readFileSync(
      "db/migrations/0040_curved_purple_man.sql",
      "utf8",
    );
    const rowPattern = /\(\s*'([^']+)',\s*(\d+),\s*'([^']+)',\s*'([^']+)',\s*ARRAY\[(.*?)\]::text\[\],\s*ARRAY\[(.*?)\]::text\[\],\s*\$\$([\s\S]*?)\$\$::jsonb,\s*'(draft|active|retired)'\s*\)/g;
    const seeded = [...migration.matchAll(rowPattern)].map((match) => ({
      key: match[1]!,
      version: Number(match[2]),
      titleKey: match[3]!,
      descriptionKey: match[4]!,
      audienceRoles: sqlArray(match[5]!),
      requiredCapabilities: sqlArray(match[6]!),
      steps: JSON.parse(match[7]!),
      status: match[8]!,
    }));
    expect(seeded).toEqual(CORE_GUIDANCE_FLOWS);
    expect(migration).toContain('ON CONFLICT ("key", "version") DO NOTHING');
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|ALTER COLUMN/i);
  });
});
