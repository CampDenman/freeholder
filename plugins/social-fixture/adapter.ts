// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Fixture social network used to prove C9.31: a plugin registers here, and
// the composer, profile table and admin hub do not learn its id.
import { createSocialNetwork, socialAdapters } from "@/adapters/social";

export const FIXTURE_SOCIAL_NETWORK_ID = "fixture_net";

export function createFixtureSocialNetwork() {
  return createSocialNetwork({
    id: FIXTURE_SOCIAL_NETWORK_ID,
    label: "Fixture network",
    authorizeUrl: "https://fixture.example/oauth/authorize",
    tokenUrl: "https://fixture.example/oauth/token",
    identityUrl: "https://fixture.example/me",
    scopes: ["read", "write"],
    extras: ["posts", "comments"],
    clientId: () => process.env.FIXTURE_SOCIAL_CLIENT_ID,
    clientSecret: () => process.env.FIXTURE_SOCIAL_CLIENT_SECRET,
    parseIdentity: () => ({
      providerAccountId: "fix-1",
      displayName: "Fixture",
      handle: "fixture",
    }),
  });
}

/** Idempotent: tests and a plugin boot may both ask. */
export function registerFixtureSocialNetwork(): void {
  try {
    socialAdapters.get(FIXTURE_SOCIAL_NETWORK_ID);
  } catch {
    socialAdapters.register(createFixtureSocialNetwork());
  }
}
