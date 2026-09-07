// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Private daily update check (MASTER.md §39.3, C10.04). A plain GET of a
// static file. No instance identifier, no telemetry, nothing reported upstream.
import { createHash } from "node:crypto";
import { env } from "@/core/env";
import { assertPublicHttpUrl } from "@/core/import/contract";
import { verifyReleaseFeed, type VerifiedFeed } from "./feed";

export const DEFAULT_UPDATE_FEED_URL =
  "https://github.com/CampDenman/freeholder/releases/latest/download/releases.json";

/** 96 slots of 15 minutes cover a UTC day. */
export const CHECK_SLOT_COUNT = 96;
export const CHECK_SLOT_MINUTES = 15;

export const UPDATE_CHECK_HEADERS = {
  Accept: "application/json",
  "User-Agent": "Freeholder-Updater",
} as const;

export function updateCheckEnabled(value = env().FREEHOLDER_UPDATE_CHECK): boolean {
  return value !== "off";
}

export function updateFeedUrl(value = env().FREEHOLDER_UPDATE_FEED_URL): string {
  return value ?? DEFAULT_UPDATE_FEED_URL;
}

/** Deterministic 15-minute UTC slot so a fleet does not stampede one endpoint. */
export function jitterSlot(seed: string): number {
  const digest = createHash("sha256").update(seed).digest();
  return digest.readUInt16BE(0) % CHECK_SLOT_COUNT;
}

export function isCheckSlot(now: Date, seed: string): boolean {
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return Math.floor(minutes / CHECK_SLOT_MINUTES) === jitterSlot(seed);
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

export async function fetchReleaseFeed(
  url: string,
  fetchImpl: FetchLike,
): Promise<unknown> {
  const parsed = assertPublicHttpUrl(url);
  if ([...parsed.searchParams.keys()].length > 0) {
    throw new Error("The update feed URL must not carry query parameters.");
  }
  const response = await fetchImpl(parsed.toString(), {
    method: "GET",
    headers: { ...UPDATE_CHECK_HEADERS },
  });
  if (!response.ok) {
    throw new Error(`The update feed answered ${response.status}.`);
  }
  return JSON.parse(await response.text()) as unknown;
}

export type UpdateCheckResult =
  | { checked: false; reason: "off" | "slot" }
  | { checked: true; feed: VerifiedFeed };

export async function runUpdateCheck(options: {
  enabled: boolean;
  feedUrl: string;
  fetchImpl: FetchLike;
}): Promise<UpdateCheckResult> {
  if (!options.enabled) return { checked: false, reason: "off" };
  const document = await fetchReleaseFeed(options.feedUrl, options.fetchImpl);
  return { checked: true, feed: verifyReleaseFeed(document) };
}

export async function runScheduledUpdateCheck(
  now = new Date(),
  fetchImpl: FetchLike = fetch,
): Promise<UpdateCheckResult> {
  const e = env();
  if (!updateCheckEnabled(e.FREEHOLDER_UPDATE_CHECK)) {
    return { checked: false, reason: "off" };
  }
  if (!isCheckSlot(now, e.APP_URL)) {
    return { checked: false, reason: "slot" };
  }
  return runUpdateCheck({
    enabled: true,
    feedUrl: updateFeedUrl(e.FREEHOLDER_UPDATE_FEED_URL),
    fetchImpl,
  });
}
