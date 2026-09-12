// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.27: private gallery bytes share C10.30's lease and revocation.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import {
  cacheKey,
  freshnessLabel,
  noCache,
  PRIVATE_CACHE_LEASE_MS,
  readThrough,
  type Cache,
  type Freshness,
} from "@freeholder/mobile-app";
import { privateCaches, privateCacheOwner } from "./cache";
import { assertOnContract, type Caller, type ScreenData } from "./screen-data";
import { bytesToBase64, fetchBytesWithTimeout } from "./transport";

export interface GalleryImage {
  mime: string;
  uri: string;
}

export function galleryImageCacheKey(instanceUrl: string, slug: string, itemId: string): string {
  // Omit the gallery session so a re-open within the lease still hits; the
  // user vault is what sign-out wipes.
  return cacheKey(instanceUrl, "galleries.viewItem", { slug, itemId });
}

export async function readGalleryImage(
  caller: Caller,
  input: { slug: string; itemId: string; galleryToken: string },
  cache: Cache,
): Promise<{ value: GalleryImage | null; freshness: Freshness; expiresAt?: number }> {
  assertOnContract("gallery", "galleries.viewItem");
  return readThrough<GalleryImage>(
    {
      key: galleryImageCacheKey(caller.instanceUrl, input.slug, input.itemId),
      kind: "query",
      service: "galleries.viewItem",
      maxAgeMs: PRIVATE_CACHE_LEASE_MS,
    },
    async () => {
      const response = await fetchBytesWithTimeout(
        `${caller.instanceUrl}/g/${encodeURIComponent(input.slug)}/view/${encodeURIComponent(input.itemId)}`,
        {
          method: "GET",
          credentials: "omit",
          headers: { authorization: `Bearer ${input.galleryToken}` },
        },
      );
      if (!response.ok) {
        throw Object.assign(new Error(`galleries.viewItem failed (${response.status}).`), { status: response.status });
      }
      const mime = (response.mime ?? "application/octet-stream").split(";")[0]!.trim() || "application/octet-stream";
      return { mime, uri: `data:${mime};base64,${bytesToBase64(await response.bytes())}` };
    },
    cache,
  );
}

export function usePrivateImage(input: {
  caller: Caller | null;
  slug: string;
  itemId: string;
  galleryToken: string | null;
}): ScreenData<GalleryImage> {
  const { caller, slug, itemId, galleryToken } = input;
  const instanceUrl = caller?.instanceUrl;
  const token = caller?.token;
  const owner = privateCacheOwner({ instanceUrl: instanceUrl ?? "", token: token ?? "" });
  const privateCache = useSyncExternalStore(privateCaches.subscribe, () => privateCaches.get(owner), () => noCache);
  const appState = useSyncExternalStore(subscribeAppState, () => AppState.currentState, () => "active");
  const visible = Boolean(token) && appState !== "background" && appState !== "inactive";
  const enabled = Boolean(instanceUrl && token && galleryToken && slug && itemId);
  const identity = JSON.stringify([instanceUrl, token, slug, itemId, galleryToken, enabled, appState]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Omit<ScreenData<GalleryImage>, "reload"> & { identity?: string; cache?: Cache }>({
    value: null,
    loading: true,
    staleness: null,
    freshness: null,
    error: null,
  });
  const reload = useCallback(() => setAttempt((count) => count + 1), []);

  useEffect(() => {
    const publish = (next: Omit<ScreenData<GalleryImage>, "reload">) => setState({ ...next, identity, cache: privateCache });
    if (!enabled || !instanceUrl || !galleryToken || !visible) {
      publish({ value: null, loading: false, staleness: null, freshness: null, error: null });
      return;
    }
    let cancelled = false;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    publish({ value: null, loading: true, staleness: null, freshness: null, error: null });
    void (async () => {
      try {
        const result = await readGalleryImage(
          { instanceUrl, token: token ?? null },
          { slug, itemId, galleryToken },
          privateCache,
        );
        if (cancelled) return;
        publish({
          value: result.value,
          loading: false,
          staleness: freshnessLabel(result.freshness),
          freshness: result.freshness,
          error: result.value === null && result.freshness.state === "empty" ? freshnessLabel(result.freshness) : null,
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
  }, [enabled, instanceUrl, token, slug, itemId, galleryToken, privateCache, visible, identity, reload, attempt]);

  if (state.identity !== identity || state.cache !== privateCache || !visible) {
    return { value: null, loading: enabled && visible, staleness: null, freshness: null, error: null, reload };
  }
  return { value: state.value, loading: state.loading, staleness: state.staleness, freshness: state.freshness, error: state.error, reload };
}

function subscribeAppState(listener: () => void) {
  const subscription = AppState.addEventListener("change", listener);
  return () => subscription.remove();
}
