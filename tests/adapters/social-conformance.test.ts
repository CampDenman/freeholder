// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Fixture-based social adapter conformance (MASTER.md §33, C9.24).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { definePlugin } from "@freeholder/plugin-kit";
import { socialAdapters } from "@/adapters/social";
import { SOCIAL_NETWORK_IDS } from "@/modules/social/contract";
import fixtureManifest from "../../plugins/social-fixture/manifest";
import {
  FIXTURE_SOCIAL_NETWORK_ID,
  registerFixtureSocialNetwork,
} from "../../plugins/social-fixture/adapter";

describe("social adapter conformance", () => {
  it("registers the eight built-in networks plus the none fallback", () => {
    const ids = socialAdapters.list().map((adapter) => adapter.id);
    expect(ids).toContain("none");
    for (const id of SOCIAL_NETWORK_IDS) {
      expect(ids).toContain(id);
    }
  });

  it("lets a fixture plugin add a network without touching core or the composer", () => {
    expect(fixtureManifest.kind).toBe("plugin");
    expect(fixtureManifest.capabilities.adapters).toEqual(["social"]);
    expect(SOCIAL_NETWORK_IDS).not.toContain(FIXTURE_SOCIAL_NETWORK_ID);
    registerFixtureSocialNetwork();
    const adapter = socialAdapters.get(FIXTURE_SOCIAL_NETWORK_ID);
    expect(adapter.label).toBe("Fixture network");
    expect(adapter.declaredCapabilities.publish).toBe(true);
    expect(adapter.declaredCapabilities.respond).toBe(true);
    process.env.FIXTURE_SOCIAL_CLIENT_ID = "fixture-id";
    process.env.FIXTURE_SOCIAL_CLIENT_SECRET = "fixture-secret";
    expect(adapter.authorizationUrl({ redirectUri: "https://app.example/cb", state: "s" })).toContain(
      "fixture.example",
    );
    delete process.env.FIXTURE_SOCIAL_CLIENT_ID;
    delete process.env.FIXTURE_SOCIAL_CLIENT_SECRET;
    for (const path of [
      "src/modules/social/compose.ts",
      "src/modules/social/schema.ts",
      "src/modules/social/policy.ts",
      "app/(admin)/admin/social/page.tsx",
    ]) {
      expect(readFileSync(path, "utf8")).not.toContain(FIXTURE_SOCIAL_NETWORK_ID);
    }
  });

  it("is a real plugin contract, not an inline test stub", () => {
    const plugin = definePlugin({
      name: "social-fixture",
      version: "0.1.0",
      freeholder: ">=0.0.0",
      license: "Apache-2.0",
      permissions: ["social:view", "network:external"],
      requires: ["core", "social"],
      capabilities: { adapters: ["social"] },
    });
    expect(plugin.kind).toBe("plugin");
    expect(fixtureManifest.name).toBe(plugin.name);
  });

  it("declares capabilities per network rather than pretending they are identical", () => {
    expect(socialAdapters.get("instagram").declaredCapabilities.extras).toContain("stories");
    expect(socialAdapters.get("google_business").declaredCapabilities.extras).toContain("hours");
    expect(socialAdapters.get("youtube").declaredCapabilities.extras).toContain("videos");
    expect(socialAdapters.get("x").pkce).toBe(true);
    expect(socialAdapters.get("instagram").pkce).toBe(false);
  });
});
