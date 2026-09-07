// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

export const FEED_SCHEMA: "freeholder/releases/v1";

export class ReleaseFeedError extends Error {
  constructor(message: string);
}

export function canonicalJson(value: unknown): string;
export function unsignedEnvelope(feed: Record<string, unknown>): Record<string, unknown>;
export function signFeed(
  feed: Record<string, unknown>,
  privateKeyPem: string,
  keyId: string,
  signedAt?: string,
): Record<string, unknown>;
export function verifyFeed(
  feed: unknown,
  keys: { id: string; publicKey: string }[],
): Record<string, unknown>;
export function upsertRelease(
  releases: Record<string, unknown>[],
  entry: Record<string, unknown>,
): Record<string, unknown>[];
export function buildReleaseEntry(input: {
  version?: string;
  channel?: string;
  minFromVersion?: string;
  schemaRisk?: string;
  cvss?: number | null;
  severity?: string;
  manualSteps?: { id: string; summary: string }[];
  pluginApi?: string;
  digest?: string;
  image?: string;
  notesUrl?: string;
  publishedAt?: string;
  provenance?: { repository?: string; workflow?: string };
}): Record<string, unknown>;
