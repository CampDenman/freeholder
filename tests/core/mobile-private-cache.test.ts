// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.30: private data must expire, and old asynchronous work stays revoked.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  cacheKey, discoverWithCache, encryptedCache, noCache, privateCacheScope,
  readThrough, rememberInstance, revocableCache, serviceResponse, PRIVATE_CACHE_LEASE_MS,
  type CacheStorage, type Instance,
} from "../../packages/mobile-app/src/index";

function storage(): CacheStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async get(key) { return data.get(key) ?? null; },
    async set(key, value) { data.set(key, value); },
    async delete(key) { data.delete(key); },
    async clear() { data.clear(); },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const offline = async () => { throw new Error("network offline"); };
const input = { key: "private", kind: "query" as const, service: "portal.myRecords", maxAgeMs: PRIVATE_CACHE_LEASE_MS };
afterEach(() => vi.useRealTimers());

describe("private read leases (C10.30)", () => {
  it.each(["null", "<html>Forbidden</html>", '{"error":{"message":"Access removed"}}'])("preserves denials with an error body of %s", async (body) => {
    const cache = storage();
    await readThrough(input, async () => "private", cache);
    await expect(readThrough(input, () => serviceResponse("portal.myRecords", { ok: false, status: 403, text: async () => body }), cache))
      .rejects.toMatchObject({ status: 403 });
    expect(cache.data.size).toBe(0);
  });

  it("preserves denial when its response body cannot be read", async () => {
    await expect(serviceResponse("portal.myRecords", { ok: false, status: 401, text: async () => { throw new Error("disconnected body"); } }))
      .rejects.toMatchObject({ status: 401 });
  });
  it("expires at the exact boundary and never renews on repeated offline reads", async () => {
    let now = 1_000_000;
    const cache = storage();
    const read = { ...input, now: () => now };
    expect(await readThrough(read, async () => "invoice", cache)).toMatchObject({ value: "invoice", expiresAt: 1_060_000 });
    now += 30_000;
    expect(await readThrough(read, offline, cache)).toMatchObject({ value: "invoice", expiresAt: 1_060_000, freshness: { state: "cached" } });
    now += 29_999;
    expect((await readThrough(read, offline, cache)).value).toBe("invoice");
    now++;
    expect((await readThrough(read, offline, cache)).value).toBeNull();
    expect(cache.data.size).toBe(0);
  });

  it.each([401, 403, 404])("evicts and propagates HTTP %s instead of serving a previously authorized read", async (status) => {
    const cache = storage();
    await readThrough(input, async () => "private", cache);
    const denial = Object.assign(new Error("denied"), { status });
    await expect(readThrough(input, async () => { throw denial; }, cache)).rejects.toBe(denial);
    expect((await readThrough(input, offline, cache)).value).toBeNull();
  });

  it.each(["not a date", "2099-01-01T00:00:00.000Z"])("discards invalid or future timestamps: %s", async (fetchedAt) => {
    const cache = storage();
    await cache.set(input.key, JSON.stringify({ value: "private", fetchedAt }));
    expect((await readThrough(input, offline, cache)).value).toBeNull();
    expect(cache.data.size).toBe(0);
  });

  it("includes network and persistence latency in the lease", async () => {
    let now = 100_000;
    const cache = storage();
    const read = { ...input, now: () => now };
    expect((await readThrough(read, async () => { now += PRIVATE_CACHE_LEASE_MS; return "late"; }, cache)).value).toBeNull();
    expect(cache.data.size).toBe(0);
    cache.set = async (key, value) => { now += PRIVATE_CACHE_LEASE_MS; cache.data.set(key, value); };
    expect((await readThrough(read, async () => "late disk", cache)).value).toBeNull();
    expect(cache.data.size).toBe(0);
  });

  it("keeps live data when persistence fails, and treats unavailable storage as an offline miss", async () => {
    const cache = storage();
    cache.set = async () => { throw new Error("disk full"); };
    cache.get = async () => { throw new Error("keychain locked"); };
    expect((await readThrough(input, async () => "live", cache)).value).toBe("live");
    expect((await readThrough(input, offline, cache)).value).toBeNull();
  });

  it.each([0, -1, Infinity, NaN])("rejects an invalid lease of %s before making a request", async (maxAgeMs) => {
    const call = vi.fn(async () => "live");
    await expect(readThrough({ ...input, maxAgeMs }, call, storage())).rejects.toThrow("finite and positive");
    expect(call).not.toHaveBeenCalled();
  });
});

describe("revocation and account transitions (C10.30)", () => {
  it("waits for a pending write, clears it, and refuses queued or late writes", async () => {
    const disk = storage();
    const started = deferred<void>();
    const finish = deferred<void>();
    const originalSet = disk.set;
    disk.set = async (key, value) => { started.resolve(); await finish.promise; await originalSet(key, value); };
    const cache = revocableCache(disk);
    const writing = cache.set("a", "private");
    await started.promise;
    const queued = cache.set("b", "queued");
    const revoked = cache.revoke();
    finish.resolve();
    await Promise.all([writing, queued, revoked]);
    await cache.set("late", "private");
    expect(disk.data.size).toBe(0);
  });

  it("hides a read already in progress when revocation occurs", async () => {
    const disk = storage();
    const started = deferred<void>();
    const finish = deferred<string>();
    disk.get = async () => { started.resolve(); return finish.promise; };
    const cache = revocableCache(disk);
    const reading = cache.get("private");
    await started.promise;
    const revoked = cache.revoke();
    finish.resolve("old account");
    expect(await reading).toBeNull();
    await revoked;
  });

  it("does not poison the operation queue when a disk write fails", async () => {
    const disk = storage();
    disk.set = async () => { throw new Error("disk full"); };
    const cache = revocableCache(disk);
    await expect(cache.set("key", "value")).rejects.toThrow("disk full");
    await expect(cache.revoke()).resolves.toBeUndefined();
    expect(await cache.get("key")).toBeNull();
  });

  it("invalidates mounted readers synchronously and ignores a denial from the previous account", async () => {
    const disk = storage();
    const scope = privateCacheScope({ open: async () => disk, clear: () => disk.clear() });
    await scope.activate("account-a");
    const old = scope.get("account-a");
    await old.set("private", "a");
    const listener = vi.fn();
    const unsubscribe = scope.subscribe(listener);
    const switching = scope.activate("account-b");
    expect(scope.get("account-a")).toBe(noCache);
    expect(listener).toHaveBeenCalledTimes(1);
    await switching;
    const current = scope.get("account-b");
    await current.set("private", "b");
    await old.set("late", "a");
    await scope.clear("account-a");
    expect(await current.get("private")).toBe("b");
    expect(await current.get("late")).toBeNull();
    const clearing = scope.clear("account-b");
    expect(scope.get("account-b")).toBe(noCache);
    await clearing;
    expect(disk.data.size).toBe(0);
    unsubscribe();
  });

  it("cannot activate a keychain open that finishes after sign-out", async () => {
    const disk = storage();
    const started = deferred<void>();
    const finish = deferred<CacheStorage>();
    const clear = vi.fn(() => disk.clear());
    const scope = privateCacheScope({ open: async () => { started.resolve(); return finish.promise; }, clear });
    const opening = scope.activate("account-a");
    await started.promise;
    const clearing = scope.clear();
    finish.resolve(disk);
    await Promise.all([opening, clearing]);
    expect(scope.get("account-a")).toBe(noCache);
    expect(clear).toHaveBeenCalledOnce();
  });

  it("runs key destruction even if file cleanup fails, then allows a fresh account", async () => {
    const disk = storage();
    const clear = vi.fn(async () => {});
    const scope = privateCacheScope({ open: async () => disk, clear });
    await scope.activate("account-a");
    disk.clear = async () => { throw new Error("OS refused deletion"); };
    await expect(scope.clear()).rejects.toThrow("OS refused deletion");
    expect(clear).toHaveBeenCalledOnce();
    await scope.activate("account-b");
    expect(scope.get("account-b")).not.toBe(noCache);
  });
});

describe("encrypted persistence (C10.30)", () => {
  // Exercise real authenticated encryption without importing native binaries
  // into the root workspace. The Expo adapter supplies AES-GCM on device.
  function cipher(key = randomBytes(32)) {
    return {
      async seal(plaintext: string) {
        const iv = randomBytes(12);
        const encrypt = createCipheriv("aes-256-gcm", key, iv);
        const body = Buffer.concat([encrypt.update(plaintext, "utf8"), encrypt.final()]);
        return Buffer.concat([iv, encrypt.getAuthTag(), body]).toString("base64");
      },
      async open(ciphertext: string) {
        const bytes = Buffer.from(ciphertext, "base64");
        const decrypt = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
        decrypt.setAuthTag(bytes.subarray(12, 28));
        return Buffer.concat([decrypt.update(bytes.subarray(28)), decrypt.final()]).toString("utf8");
      },
    };
  }

  it("survives recreation with the same key, stores ciphertext, and binds it to the requested cache key", async () => {
    const disk = storage();
    const crypto = cipher();
    const first = encryptedCache(disk, crypto);
    await first.set("invoice-a", "Private customer invoice");
    expect(disk.data.get("invoice-a")).not.toContain("Private customer invoice");
    const restarted = encryptedCache(disk, crypto);
    expect(await restarted.get("invoice-a")).toBe("Private customer invoice");
    disk.data.set("invoice-b", disk.data.get("invoice-a")!);
    expect(await restarted.get("invoice-b")).toBeNull();
    expect(disk.data.has("invoice-b")).toBe(false);
  });

  it("rejects tampered ciphertext and data encrypted with a different session key", async () => {
    const disk = storage();
    const cache = encryptedCache(disk, cipher());
    await cache.set("private", "customer");
    const bytes = Buffer.from(disk.data.get("private")!, "base64");
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    disk.data.set("private", bytes.toString("base64"));
    expect(await cache.get("private")).toBeNull();
    await cache.set("private", "customer");
    expect(await encryptedCache(disk, cipher()).get("private")).toBeNull();
    expect(disk.data.size).toBe(0);
  });
});

describe("offline instance restart (C10.30)", () => {
  const instance: Instance = {
    url: "https://example.test", contractVersion: 1, platformVersion: "0.1.0", name: "Example",
    tagline: null, locales: { default: "en", enabled: ["en"] }, currency: "CAD",
    timezone: "America/Vancouver", country: "CA", branding: { logoUrl: null, colors: {}, fontSans: null },
    api: { base: "", openapi: "", mcp: "" }, storeUrls: { ios: null, android: null },
  };

  it("can reopen remembered public branding while private snapshots still expire independently", async () => {
    vi.useFakeTimers();
    const cache = storage();
    await rememberInstance(instance, cache);
    await readThrough(input, async () => "invoice", cache);
    expect(await discoverWithCache(instance.url, offline, cache)).toEqual({ ok: true, instance });
    vi.advanceTimersByTime(PRIVATE_CACHE_LEASE_MS);
    expect(await discoverWithCache(instance.url, offline, cache)).toEqual({ ok: true, instance });
    expect((await readThrough(input, offline, cache)).value).toBeNull();
    expect((await discoverWithCache("https://another.test", offline, cache)).ok).toBe(false);
  });

  it.each([
    { freeholder: false },
    { freeholder: true, setupComplete: false },
    { freeholder: true, contractVersion: 99 },
  ])("does not conceal an authoritative discovery refusal with old branding: %j", async (document) => {
    const cache = storage();
    await rememberInstance(instance, cache);
    const result = await discoverWithCache(instance.url, async () => ({ ok: true, status: 200, json: async () => document }), cache);
    expect(result.ok).toBe(false);
    expect((await discoverWithCache(instance.url, offline, cache)).ok).toBe(false);
  });

  it("rejects a cached instance with a mismatched URL or unsupported contract", async () => {
    for (const value of [{ ...instance, url: "https://another.test" }, { ...instance, contractVersion: 99 }]) {
      const cache = storage();
      await cache.set(cacheKey(instance.url, "instance", {}), JSON.stringify({ value, fetchedAt: new Date().toISOString() }));
      expect((await discoverWithCache(instance.url, offline, cache)).ok).toBe(false);
    }
  });
});
