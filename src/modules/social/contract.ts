// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Public vocabulary for the social connection hub (MASTER.md §33, C9.24).
export const SOCIAL_ASSIGNMENTS = ["user", "business", "locations"] as const;
export type SocialAssignment = (typeof SOCIAL_ASSIGNMENTS)[number];

export const SOCIAL_APPROVAL_POLICIES = ["none", "required"] as const;
export type SocialApprovalPolicy = (typeof SOCIAL_APPROVAL_POLICIES)[number];

export const SOCIAL_PROFILE_STATUSES = [
  "pending_review",
  "active",
  "needs_reconnect",
  "revoked",
] as const;
export type SocialProfileStatus = (typeof SOCIAL_PROFILE_STATUSES)[number];

export const SOCIAL_HEALTH = ["ok", "expiring", "expired", "error"] as const;
export type SocialHealth = (typeof SOCIAL_HEALTH)[number];

export const SOCIAL_NETWORK_IDS = [
  "instagram",
  "facebook",
  "tiktok",
  "youtube",
  "linkedin",
  "x",
  "pinterest",
  "google_business",
] as const;
