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

export interface SocialAdapter {
  readonly id: string;
  readonly status: AdapterStatus;
  publish(request: SocialPublicationRequest): Promise<SocialPublicationResult>;
  remove(request: { providerRef: string; idempotencyKey: string }): Promise<void>;
  verifyWebhook(request: RawProviderRequest): Promise<readonly SocialProviderEvent[]>;
}
