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
