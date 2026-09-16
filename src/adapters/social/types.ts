// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Social publishing edge; review, authorization, and content remain local.

import type { AdapterStatus, RawProviderRequest } from "../types";

export interface SocialPublicationRequest {
  accountRef: string;
  text: string;
  media: readonly { url: string; altText?: string }[];
  publishAt?: string;
  idempotencyKey: string;
}

export interface SocialPublicationResult {
  providerRef: string;
  status: "scheduled" | "published";
  url?: string;
}

export interface SocialProviderEvent {
  id: string;
  providerRef: string;
  kind: "published" | "failed" | "deleted";
  occurredAt: string;
}

/**
 * What this network's API currently permits, not what the owner has switched
 * on. Owner grants live on the profile row (C9.24); this is capability
 * negotiation so the composer cannot pretend every network is the same.
 */
export interface SocialCapabilities {
  read: boolean;
  respond: boolean;
  publish: boolean;
  extras: readonly string[];
}

export interface SocialIdentity {
  providerAccountId: string;
  displayName: string;
  handle: string | null;
}

export interface SocialOAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  tokenType: string;
  scopes: readonly string[];
}

export interface SocialOwnedMedia {
  url: string;
  filename: string;
  mime: string;
  altText?: string;
}

export interface SocialOwnedPost {
  providerRef: string;
  url: string | null;
  body: string;
  publishedAt: string;
  media: readonly SocialOwnedMedia[];
}

export interface SocialExternalReview {
  providerRef: string;
  rating: number;
  body: string;
  displayName: string | null;
  email: string | null;
  occurredAt: string;
}

export interface SocialHoursPeriod {
  weekday: number;
  opens: string;
  closes: string;
  closed: boolean;
}

export interface SocialInteraction {
  providerRef: string;
  postProviderRef: string;
  kind: "comment" | "mention";
  body: string;
  occurredAt: string;
  authorHandle: string;
  /** Only when the provider actually gave an address. Handles are not identity. */
  authorEmail: string | null;
}

export interface SocialAdapter {
  readonly id: string;
  readonly label: string;
  readonly status: AdapterStatus;
  /** Static: what this network can ever do, before anyone connects. */
  readonly declaredCapabilities: SocialCapabilities;
  authorizationUrl(input: {
    redirectUri: string;
    state: string;
    codeChallenge?: string;
  }): string;
  /** True when this network's token exchange needs PKCE (X, some others). */
  readonly pkce: boolean;
  exchangeCode(input: {
    code: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<SocialOAuthTokens>;
  identity(accessToken: string): Promise<SocialIdentity>;
  capabilities(scopes: readonly string[]): SocialCapabilities;
  health(accessToken: string): Promise<{ ok: boolean; message: string }>;
  listOwnedPosts(accessToken: string): Promise<readonly SocialOwnedPost[]>;
  listInteractions(
    accessToken: string,
    postProviderRef: string,
  ): Promise<readonly SocialInteraction[]>;
  listReviews(accessToken: string): Promise<readonly SocialExternalReview[]>;
  pushHours(
    accessToken: string,
    periods: readonly SocialHoursPeriod[],
  ): Promise<void>;
  publish(request: SocialPublicationRequest): Promise<SocialPublicationResult>;
  remove(request: { providerRef: string; idempotencyKey: string }): Promise<void>;
  verifyWebhook(request: RawProviderRequest): Promise<readonly SocialProviderEvent[]>;
}
