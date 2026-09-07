// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Social hub onboarding in normal presets (MASTER.md §33, C9.31).
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { users } from "@/core/auth/schema";
import { db } from "@/core/db";
import { configSchema } from "@/core/config";
import { ready } from "@/core/runtime";
import {
  NORMAL_SOCIAL_PRESETS,
  SOCIAL_ONBOARDING_SURFACE,
  socialOnboardingEnabled,
} from "@/modules/social/capabilities";
import { SOCIAL_NETWORK_IDS } from "@/modules/social/contract";
import socialOnboarding from "@/modules/social/onboarding";
import { networks, profiles } from "@/modules/social/service";
import fixtureManifest from "../../plugins/social-fixture/manifest";
import {
  FIXTURE_SOCIAL_NETWORK_ID,
  registerFixtureSocialNetwork,
} from "../../plugins/social-fixture/adapter";
import { SOCIAL_SURFACE } from "../../packages/templates/src/presets";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe("social onboarding surface (C9.31)", () => {
  it("is enabled in every normal business preset and never auto-connects", () => {
    expect(SOCIAL_ONBOARDING_SURFACE).toEqual(SOCIAL_SURFACE);
    expect(SOCIAL_ONBOARDING_SURFACE.autoAuthorize).toBe(false);
    expect(SOCIAL_ONBOARDING_SURFACE.autoPublish).toBe(false);
    for (const preset of NORMAL_SOCIAL_PRESETS) {
      expect(socialOnboardingEnabled(preset)).toBe(true);
    }
    expect(socialOnboardingEnabled("custom")).toBe(true);
    const parsed = configSchema.parse({});
    expect(socialOnboardingEnabled(parsed.preset)).toBe(true);
  });

  it("contributes one hub target and a connect flow that completes on beginOAuth", () => {
    expect(socialOnboarding.targets).toEqual([
      expect.objectContaining({
        key: "social.admin-hub",
        href: "/admin/social",
      }),
    ]);
    const [flow] = socialOnboarding.guidance;
    expect(flow?.key).toBe("social.connect-hub");
    expect(flow?.steps[0]?.href).toBe("/admin/social");
    expect(flow?.steps[0]?.outcome).toEqual({
      type: "audit",
      actions: ["social.beginOAuth"],
    });
  });

  it("discovers every adapter through one capability-negotiated hub", () => {
    const page = readFileSync("app/(admin)/admin/social/page.tsx", "utf8");
    expect(page).toContain("network.capabilities");
    expect(page).toContain("profile.capabilities");
    expect(page).toContain("profileMayPublish");
    expect(page).toContain("CapabilityPills");
    expect(page).toContain("(known ?? []).map");
    expect(page).not.toContain("SOCIAL_NETWORK_IDS");
    expect(page).not.toContain(FIXTURE_SOCIAL_NETWORK_ID);
  });

  it("installs a fixture plugin that the composer and profile table do not name", () => {
    expect(fixtureManifest.kind).toBe("plugin");
    expect(fixtureManifest.capabilities.adapters).toEqual(["social"]);
    expect(fixtureManifest.requires).toEqual(expect.arrayContaining(["social"]));
    registerFixtureSocialNetwork();
    expect(SOCIAL_NETWORK_IDS).not.toContain(FIXTURE_SOCIAL_NETWORK_ID);
    for (const path of [
      "src/modules/social/compose.ts",
      "src/modules/social/schema.ts",
      "src/modules/social/policy.ts",
    ]) {
      expect(readFileSync(path, "utf8")).not.toContain(FIXTURE_SOCIAL_NETWORK_ID);
    }
  });
});

describe.runIf(hasDatabase)("social onboarding never auto-authorizes", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    await ready();
  }, 180_000);

  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values({
      id: OWNER.userId,
      email: "owner@example.test",
      role: "owner",
    });
  }, 60_000);

  afterAll(closeDb);

  it("lists built-in and plugin networks without creating a profile", async () => {
    registerFixtureSocialNetwork();
    const listed = await networks.call({}, OWNER);
    expect(listed.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([...SOCIAL_NETWORK_IDS, FIXTURE_SOCIAL_NETWORK_ID]),
    );
    const fixture = listed.find((entry) => entry.id === FIXTURE_SOCIAL_NETWORK_ID);
    expect(fixture?.capabilities.publish).toBe(true);
    expect(fixture?.available).toBe(false);
    expect(await profiles.call({}, OWNER)).toEqual([]);
  });
});
