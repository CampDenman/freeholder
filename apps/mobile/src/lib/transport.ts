// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.30: a disconnected request cannot leave the cache reader waiting forever.
export async function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    // Buffer inside the deadline, but expose denial status immediately even
    // when reading the body later fails or times out.
    const body = response.text().finally(() => clearTimeout(timer));
    void body.catch(() => {});
    return { ok: response.ok, status: response.status, text: () => body, json: async () => JSON.parse(await body) as unknown };
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

/** Private gallery bytes: denial status is usable even when the body never arrives. */
export async function fetchBytesWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = response.arrayBuffer().finally(() => clearTimeout(timer));
    void body.catch(() => {});
    return {
      ok: response.ok,
      status: response.status,
      mime: response.headers.get("content-type"),
      bytes: async () => new Uint8Array(await body),
    };
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += BASE64[a >> 2];
    out += BASE64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? BASE64[((b & 15) << 2) | (c >> 6)] : "=";
    out += i + 2 < bytes.length ? BASE64[c & 63] : "=";
  }
  return out;
}

/** Map a private image GET onto cached bytes, preserving denial status for eviction. */
export async function decodeGalleryImageResponse(response: {
  ok: boolean;
  status: number;
  mime: string | null;
  bytes(): Promise<Uint8Array>;
}): Promise<{ mime: string; uri: string }> {
  if (!response.ok) {
    throw Object.assign(new Error(`galleries.viewItem failed (${response.status}).`), { status: response.status });
  }
  const mime = (response.mime ?? "application/octet-stream").split(";")[0]!.trim() || "application/octet-stream";
  return { mime, uri: `data:${mime};base64,${bytesToBase64(await response.bytes())}` };
}
