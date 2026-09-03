// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Fixture-based social adapter conformance (MASTER.md §33, C9.24).
import { describe, expect, it } from "vitest";
import { createSocialNetwork, socialAdapters } from "@/adapters/social";
import { SOCIAL_NETWORK_IDS } from "@/modules/social/contract";

describe("social adapter conformance", () => {
  it("registers the eight built-in networks plus the none fallback", () => {
    const ids = socialAdapters.list().map((adapter) => adapter.id);
    expect(ids).toContain("none");
    for (const id of SOCIAL_NETWORK_IDS) {
      expect(ids).toContain(id);
    }
  });

  it("lets a fixture network register without touching core tables", () => {
    const id = "fixture_net";
    try {
      socialAdapters.get(id);
    } catch {
      socialAdapters.register(
        createSocialNetwork({
          id,
          label: "Fixture",
          authorizeUrl: "https://fixture.example/oauth/authorize",
          tokenUrl: "https://fixture.example/oauth/token",
          identityUrl: "https://fixture.example/me",
          scopes: ["read", "write"],
          extras: ["posts"],
          clientId: () => "fixture-id",
          clientSecret: () => "fixture-secret",
          parseIdentity: () => ({
            providerAccountId: "fix-1",
            displayName: "Fixture",
            handle: "fixture",
          }),
        }),
      );
    }
    const adapter = socialAdapters.get(id);
    expect(adapter.label).toBe("Fixture");
    expect(adapter.declaredCapabilities.publish).toBe(true);
    expect(adapter.authorizationUrl({ redirectUri: "https://app.example/cb", state: "s" })).toContain(
      "fixture.example",
    );
  });

  it("declares capabilities per network rather than pretending they are identical", () => {
    expect(socialAdapters.get("instagram").declaredCapabilities.extras).toContain("stories");
    expect(socialAdapters.get("google_business").declaredCapabilities.extras).toContain("hours");
    expect(socialAdapters.get("youtube").declaredCapabilities.extras).toContain("videos");
    expect(socialAdapters.get("x").pkce).toBe(true);
    expect(socialAdapters.get("instagram").pkce).toBe(false);
  });
});
