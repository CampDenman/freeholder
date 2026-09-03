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
  publish(request: SocialPublicationRequest): Promise<SocialPublicationResult>;
  remove(request: { providerRef: string; idempotencyKey: string }): Promise<void>;
  verifyWebhook(request: RawProviderRequest): Promise<readonly SocialProviderEvent[]>;
}
