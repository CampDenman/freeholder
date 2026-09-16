// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.30: preserve authoritative denial status, even for malformed error bodies.
export async function serviceResponse<T>(service: string, response: {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}): Promise<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await response.text());
  } catch {
    throw Object.assign(new Error(`${service} did not answer JSON (${response.status}).`), { status: response.status });
  }
  if (!response.ok) {
    const message = (parsed as { error?: { message?: unknown } } | null)?.error?.message;
    throw Object.assign(new Error(typeof message === "string" ? message : `${service} failed (${response.status}).`), { status: response.status });
  }
  return parsed as T;
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
