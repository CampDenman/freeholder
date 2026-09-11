// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Reading a screen's data, through its declared contract (C10.23).
//
// C10.13 wrote down which services each screen may call. This is what makes
// that declaration load-bearing rather than documentation: a screen asks for a
// service *by name*, and a name its contract does not list throws before any
// request is made. A view cannot quietly grow a dependency; it has to change
// the contract, in a diff somebody reviews.
//
// Offline behaviour is `@freeholder/mobile-app`'s `readThrough` (C10.12), so
// the write-never rule and the "say when it was fetched" rule are enforced in
// one place for every screen rather than remembered in each.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { memoryCache, privateCaches, privateCacheOwner } from "./cache";
import { fetchWithTimeout } from "./transport";
import {
  cacheKey,
  freshnessLabel,
  readThrough,
  noCache,
  PRIVATE_CACHE_LEASE_MS,
  serviceResponse,
  writeThrough,
  SCREENS,
  type Cache,
  type Freshness,
  type ScreenId,
} from "@freeholder/mobile-app";

export class ServiceNotOnContract extends Error {
  constructor(screen: ScreenId, service: string) {
    super(
      `The ${screen} screen may not call ${service}. Add it to that screen's contract in packages/mobile-app/src/screens.ts, or call something it already declares.`,
    );
    this.name = "ServiceNotOnContract";
  }
}

export function assertOnContract(screen: ScreenId, service: string, write = false): void {
  const contract = SCREENS[screen];
  const allowed = write ? contract.writes : contract.reads;
  if (!allowed.includes(service)) throw new ServiceNotOnContract(screen, service);
}

export interface Caller {
  instanceUrl: string;
  token: string | null;
}

/**
 * Call one platform service over the instance's own HTTP API.
 *
 * There is no per-screen client and no bespoke endpoint: every screen speaks
 * the same `/api/v1/<service>` the website, the CLI and MCP speak.
 */
export async function callService<T>(
  caller: Caller,
  service: string,
  input: unknown,
): Promise<T> {
  const response = await fetchWithTimeout(`${caller.instanceUrl}/api/v1/${service}`, {
    method: "POST",
    credentials: "omit",
    headers: {
      "content-type": "application/json",
      ...(caller.token ? { authorization: `Bearer ${caller.token}` } : {}),
    },
    body: JSON.stringify(input ?? {}),
  });
  if (response.status === 401 && caller.token) void privateCaches.clear(privateCacheOwner({ ...caller, token: caller.token })).catch(() => {});
  return serviceResponse<T>(service, response);
}

export interface ScreenData<T> {
  value: T | null;
  loading: boolean;
  /** The one line a stale screen shows above its content, or null when live. */
  staleness: string | null;
  freshness: Freshness | null;
  error: string | null;
  reload(): void;
}

/** A tap-driven mutation. Connectivity is supplied by the screen's network state. */
export function useScreenWrite<T>(input: {
  screen: ScreenId;
  service: string;
  caller: Caller | null;
  online: boolean;
}): { pending: boolean; error: string | null; execute(params?: unknown): Promise<T> } {
  const { screen, service, caller, online } = input;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const instanceUrl = caller?.instanceUrl;
  const token = caller?.token;
  const execute = useCallback(async (params?: unknown): Promise<T> => {
    assertOnContract(screen, service, true);
    if (!instanceUrl) throw new Error("Connect to a business before making changes.");
    if (SCREENS[screen].audience === "signed-in" && !token) throw new Error("Sign in before making changes.");
    if (inFlight.current) throw new Error("A request is already in progress.");
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      return await writeThrough({ service, online }, () => callService<T>({ instanceUrl, token: token ?? null }, service, params));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      throw failure;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, [screen, service, instanceUrl, token, online]);
  return { pending, error, execute };
}

/**
 * Read one service for a screen, with the offline and staleness rules applied.
 *
 * A screen its contract marks uncacheable — booking, where cached availability
 * is availability that may be gone — reads live or not at all.
 */
export function useScreenData<T>(input: {
  screen: ScreenId;
  service: string;
  caller: Caller | null;
  cache: Cache;
  params?: unknown;
  enabled?: boolean;
}): ScreenData<T> {
  const { screen, service, caller, cache, params, enabled = true } = input;
  const [state, setState] = useState<Omit<ScreenData<T>, "reload"> & { identity?: string; cache?: Cache }>({
    value: null,
    loading: true,
    staleness: null,
    freshness: null,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  const serialized = JSON.stringify(params ?? {});
  // Screens construct caller objects while rendering. Depend on their values
  // so updating request state does not trigger an endless refetch loop.
  const instanceUrl = caller?.instanceUrl;
  const token = caller?.token;
  const owner = privateCacheOwner({ instanceUrl: instanceUrl ?? "", token: token ?? "" });
  const privateCache = useSyncExternalStore(privateCaches.subscribe, () => privateCaches.get(owner), () => noCache);
  const scopedCache = token && cache === memoryCache ? privateCache : cache;
  const appState = useSyncExternalStore(subscribeAppState, () => AppState.currentState, () => "active");
  const visible = !token || (appState !== "background" && appState !== "inactive");
  const identity = JSON.stringify([screen, service, instanceUrl, token, serialized, enabled, attempt, appState]);

  const reload = useCallback(() => setAttempt((count) => count + 1), []);

  useEffect(() => {
    const publish = (next: Omit<ScreenData<T>, "reload">) => setState({ ...next, identity, cache: scopedCache });
    if (!enabled || !instanceUrl || !visible) {
      publish({ value: null, loading: false, staleness: null, freshness: null, error: null });
      return;
    }
    let cancelled = false;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    publish({ value: null, loading: true, staleness: null, freshness: null, error: null });
    void (async () => {
      try {
        assertOnContract(screen, service);
        const result = await readThrough<T>(
          {
            key: cacheKey(instanceUrl, service, JSON.parse(serialized)),
            kind: "query",
            service,
            ...(token ? { maxAgeMs: PRIVATE_CACHE_LEASE_MS } : {}),
          },
          () => callService<T>({ instanceUrl, token: token ?? null }, service, JSON.parse(serialized)),
          SCREENS[screen].cacheable ? scopedCache : passthrough,
        );
        if (cancelled) return;
        publish({
          value: result.value,
          loading: false,
          staleness: freshnessLabel(result.freshness),
          freshness: result.freshness,
          error:
            result.value === null && result.freshness.state === "empty"
              ? freshnessLabel(result.freshness)
              : null,
        });
        if (result.expiresAt !== undefined) {
          expiry = setTimeout(() => {
            if (cancelled) return;
            publish({ value: null, loading: true, staleness: null, freshness: null, error: null });
            reload();
          }, Math.max(0, result.expiresAt - Date.now()));
        }
      } catch (error) {
        if (cancelled) return;
        publish({
          value: null,
          loading: false,
          staleness: null,
          freshness: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return () => {
      cancelled = true;
      if (expiry !== undefined) clearTimeout(expiry);
    };
  }, [screen, service, instanceUrl, token, scopedCache, serialized, enabled, visible, identity, reload]);

  // Hide the previous account/route/background result during render, before
  // effects run. Scope invalidation also hides every mounted private screen.
  if (state.identity !== identity || state.cache !== scopedCache || !visible) {
    return { value: null, loading: enabled && visible, staleness: null, freshness: null, error: null, reload };
  }
  return { value: state.value, loading: state.loading, staleness: state.staleness, freshness: state.freshness, error: state.error, reload };
}

function subscribeAppState(listener: () => void) {
  const subscription = AppState.addEventListener("change", listener);
  return () => subscription.remove();
}

/**
 * A cache that keeps nothing, for screens their contract marks uncacheable.
 *
 * Not a special case in `readThrough`: the rule lives in the contract, and the
 * reader honours it by being handed somewhere that forgets.
 */
const passthrough: Cache = {
  async get() {
    return null;
  },
  async set() {},
  async delete() {},
};
