// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.30: offline restart retains compatibility and same-instance checks.
import { APP_CONTRACT_VERSION, discover, normalizeAddress, type DiscoveryResult, type Instance } from "./discovery.js";
import { cacheKey, readThrough, type Cache } from "./offline.js";

export async function rememberInstance(instance: Instance, cache: Cache): Promise<void> {
  await readThrough({ key: cacheKey(instance.url, "instance", {}), kind: "query", service: "instance" },
    async () => instance, cache);
}

/** The caller supplies a cache scoped to an already remembered session. */
export async function discoverWithCache(
  address: string,
  fetchImpl: Parameters<typeof discover>[1],
  cache: Cache,
): Promise<DiscoveryResult> {
  const result = await discover(address, fetchImpl);
  const normalized = normalizeAddress(address);
  if ("error" in normalized) return result;
  // Discovery is public branding/configuration, not authorization to read
  // private data. Each private screen still enforces its own 60-second lease.
  const input = { key: cacheKey(normalized.url, "instance", {}), kind: "query" as const, service: "instance" };
  if (result.ok) {
    await rememberInstance(result.instance, cache);
    return result;
  }
  if (result.reason !== "unreachable") {
    await cache.delete(input.key).catch(() => {});
    return result;
  }
  const cached = await readThrough<Instance>(input, async () => { throw new Error("offline"); }, cache);
  if (!cached.value || cached.value.url !== normalized.url || !Number.isFinite(cached.value.contractVersion)
    || cached.value.contractVersion > APP_CONTRACT_VERSION) return result;
  return { ok: true, instance: cached.value };
}
