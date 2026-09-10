// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Offline is read-through, write-never (MASTER.md §35.1, C10.12).
//
// §35.1: "The app caches what it has already been shown — the gallery you were
// proofing, the invoice you were about to pay, today's bookings — and shows it
// with the time it was fetched. It does **not** queue writes. A booking made
// offline is a booking against availability that may no longer exist; a
// payment queued offline is a payment somebody believes they made. The one
// exception is media capture (C10.18), which is genuinely a queue of files
// rather than a queue of decisions, and which says plainly what has and has
// not been uploaded."
//
// That rule is enforced here rather than remembered: `readThrough` is the only
// way this module talks to the network, and it refuses a mutation outright.

export interface CacheEntry<T> {
  value: T;
  fetchedAt: string;
}

export interface Cache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class OfflineWriteRefused extends Error {
  constructor(service: string) {
    super(
      `${service} is a mutation and cannot be queued offline. A booking made offline is a booking against availability that may no longer exist.`,
    );
    this.name = "OfflineWriteRefused";
  }
}

/** One deliberate write, only while online; never cached, queued or retried. */
export async function writeThrough<T>(
  input: { service: string; online: boolean },
  call: () => Promise<T>,
): Promise<T> {
  if (!input.online) throw new OfflineWriteRefused(input.service);
  return call();
}

export type Freshness =
  | { state: "live" }
  | { state: "cached"; fetchedAt: string; reason: "offline" | "failed" }
  | { state: "empty"; reason: "offline" | "failed" };

export interface ReadResult<T> {
  value: T | null;
  freshness: Freshness;
}

/**
 * Read a query, falling back to what the customer has already been shown.
 *
 * The freshness is returned rather than hidden because a stale gallery and a
 * live one look identical, and a customer who cannot tell will assume the app
 * is broken when it is merely offline. Every screen renders the fetch time
 * when `state` is `cached`.
 */
export async function readThrough<T>(
  input: {
    key: string;
    /** Must be a query. A mutation here is a programming error, not a retry. */
    kind: "query" | "mutation";
    service: string;
  },
  call: () => Promise<T>,
  cache: Cache,
): Promise<ReadResult<T>> {
  if (input.kind === "mutation") throw new OfflineWriteRefused(input.service);

  try {
    const value = await call();
    await cache.set(
      input.key,
      JSON.stringify({ value, fetchedAt: new Date().toISOString() } satisfies CacheEntry<T>),
    );
    return { value, freshness: { state: "live" } };
  } catch (error) {
    const reason = isOffline(error) ? "offline" : "failed";
    const raw = await cache.get(input.key);
    if (!raw) return { value: null, freshness: { state: "empty", reason } };
    try {
      const entry = JSON.parse(raw) as CacheEntry<T>;
      return { value: entry.value, freshness: { state: "cached", fetchedAt: entry.fetchedAt, reason } };
    } catch {
      return { value: null, freshness: { state: "empty", reason } };
    }
  }
}

function isOffline(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /network|fetch failed|offline|ENOTFOUND|ECONNREFUSED|timeout/i.test(message);
}

/**
 * What a screen says above stale content.
 *
 * Never "Offline" alone: the useful fact is *when* this was true, because a
 * gallery from four minutes ago is worth proofing and one from last Tuesday is
 * not.
 */
export function freshnessLabel(freshness: Freshness, now = new Date()): string | null {
  if (freshness.state === "live") return null;
  if (freshness.state === "empty") {
    return freshness.reason === "offline"
      ? "You are offline, and this has not been loaded on this device yet."
      : "This could not be loaded. Pull to try again.";
  }
  const minutes = Math.max(
    0,
    Math.round((now.getTime() - new Date(freshness.fetchedAt).getTime()) / 60_000),
  );
  const ago =
    minutes < 1
      ? "just now"
      : minutes < 60
        ? `${minutes} minute${minutes === 1 ? "" : "s"} ago`
        : minutes < 60 * 24
          ? `${Math.round(minutes / 60)} hour${Math.round(minutes / 60) === 1 ? "" : "s"} ago`
          : `${Math.round(minutes / 1440)} day${Math.round(minutes / 1440) === 1 ? "" : "s"} ago`;
  return freshness.reason === "offline"
    ? `Offline — showing what was loaded ${ago}.`
    : `Could not refresh — showing what was loaded ${ago}.`;
}

/** Everything cached for one instance, dropped on sign-out. */
export function cacheKey(instanceUrl: string, service: string, input: unknown): string {
  return `${instanceUrl}|${service}|${JSON.stringify(input ?? {})}`;
}
