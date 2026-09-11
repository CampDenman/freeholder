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
