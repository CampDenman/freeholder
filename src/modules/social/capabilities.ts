// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Capability negotiation for the social hub (MASTER.md §33, C9.31).
//
// Owner grants (`allowRead` / `allowRespond` / `allowPublish`) are switches on
// the profile. This file is what the API currently permits, so the same admin
// screen can describe Instagram and a plugin network without naming either.
import type { SocialCapabilities } from "@/adapters/social";

export const SOCIAL_EXTRAS = [
  "posts",
  "comments",
  "stories",
  "videos",
  "hours",
  "reviews",
  "locations",
] as const;

export type SocialExtra = (typeof SOCIAL_EXTRAS)[number];

export const SOCIAL_ONBOARDING_SURFACE = {
  href: "/admin/social",
  autoAuthorize: false,
  autoPublish: false,
} as const;

/** Business presets that ship the social hub on day one. `custom` keeps it too. */
export const NORMAL_SOCIAL_PRESETS = [
  "creator",
  "service-business",
  "shop",
  "everything",
] as const;

export function socialOnboardingEnabled(preset: string): boolean {
  return (
    preset === "custom" ||
    (NORMAL_SOCIAL_PRESETS as readonly string[]).includes(preset)
  );
}

export function parseSocialCapabilities(value: unknown): SocialCapabilities {
  const record =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    read: Boolean(record.read),
    respond: Boolean(record.respond),
    publish: Boolean(record.publish),
    extras: Array.isArray(record.extras)
      ? record.extras.filter((entry): entry is string => typeof entry === "string")
      : [],
  };
}

export function isKnownSocialExtra(value: string): value is SocialExtra {
  return (SOCIAL_EXTRAS as readonly string[]).includes(value);
}

/** A destination only when the owner switched publish on *and* the API can. */
export function profileMayPublish(profile: {
  status: string;
  allowPublish: boolean;
  capabilities: unknown;
}): boolean {
  return (
    profile.status === "active" &&
    profile.allowPublish &&
    parseSocialCapabilities(profile.capabilities).publish
  );
}
