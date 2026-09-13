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
// The C10.18 exception is not a retry of `writeThrough` — it is a local queue
// of files (`createCaptureBatchStore`) that says what has and has not been
// uploaded, and only flushes through the live capture contract once online.

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

/**
 * §35.1's only write that may sit on the device: a capture file batch, not a
 * booking, payment, or other decision. `writeThrough` still refuses every
 * service name, including media uploads — those flush later, while online.
 */
export const OFFLINE_WRITE_EXCEPTION = "media.capture.batch" as const;

export function isOfflineWriteException(service: string): boolean {
  return service === OFFLINE_WRITE_EXCEPTION;
}

export type Freshness =
  | { state: "live" }
  | { state: "cached"; fetchedAt: string; reason: "offline" | "failed" }
  | { state: "empty"; reason: "offline" | "failed" };

export interface ReadResult<T> {
  value: T | null;
  freshness: Freshness;
  expiresAt?: number;
}

export const PRIVATE_CACHE_LEASE_MS = 60_000;

/** An authoritative denial is never an excuse to show a cached private read. */
export function isAccessDenied(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  return status === 401 || status === 403 || status === 404;
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
    maxAgeMs?: number;
    now?: () => number;
  },
  call: () => Promise<T>,
  cache: Cache,
): Promise<ReadResult<T>> {
  if (input.kind === "mutation") throw new OfflineWriteRefused(input.service);
  const now = input.now ?? Date.now;
  const startedAt = now();
  if (input.maxAgeMs !== undefined && (!Number.isFinite(input.maxAgeMs) || input.maxAgeMs <= 0)) {
    throw new Error("A private cache lease must be finite and positive.");
  }
  try {
    const value = await call();
    const expiresAt = input.maxAgeMs === undefined ? undefined : startedAt + input.maxAgeMs;
    if (expiresAt !== undefined && now() >= expiresAt) {
      await cache.delete(input.key).catch(() => {});
      return { value: null, freshness: { state: "empty", reason: "failed" } };
    }
    await cache.set(
      input.key,
      JSON.stringify({ value, fetchedAt: new Date(startedAt).toISOString() } satisfies CacheEntry<T>),
    ).catch(() => {}); // Persistence failure must not discard a successful live read.
    if (expiresAt !== undefined && now() >= expiresAt) {
      await cache.delete(input.key).catch(() => {});
      return { value: null, freshness: { state: "empty", reason: "failed" } };
    }
    return { value, freshness: { state: "live" }, ...(expiresAt === undefined ? {} : { expiresAt }) };
  } catch (error) {
    if (isAccessDenied(error)) {
      await cache.delete(input.key).catch(() => {});
      throw error;
    }
    const reason = isOffline(error) ? "offline" : "failed";
    const raw = await cache.get(input.key).catch(() => null);
    if (!raw) return { value: null, freshness: { state: "empty", reason } };
    try {
      const entry = JSON.parse(raw) as CacheEntry<T>;
      const fetchedAt = Date.parse(entry.fetchedAt);
      const expiresAt = input.maxAgeMs === undefined ? undefined : fetchedAt + input.maxAgeMs;
      if (!Number.isFinite(fetchedAt) || fetchedAt > now() || (expiresAt !== undefined && now() >= expiresAt)) {
        await cache.delete(input.key).catch(() => {});
        return { value: null, freshness: { state: "empty", reason } };
      }
      return { value: entry.value, freshness: { state: "cached", fetchedAt: entry.fetchedAt, reason }, ...(expiresAt === undefined ? {} : { expiresAt }) };
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
