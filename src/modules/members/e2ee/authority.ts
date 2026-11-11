// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.39/C11.10: an If-Match witness for the EXACT authorization snapshot
// used by the crypto operation. It is not a secret or a substitute for auth.
export type AuthorityDevice = { deviceId: string; userId: string; signatureKey: string };
export async function deliveryAuthority(conversationId: string, snapshot: { epoch: number | null; roster: string[]; entitled: AuthorityDevice[]; missing: string[] }): Promise<string> {
  const text = JSON.stringify({ v: 1, conversationId, epoch: snapshot.epoch, roster: [...snapshot.roster].sort(), entitled: snapshot.entitled.map(({ userId, deviceId, signatureKey }) => [userId, deviceId, signatureKey]).sort((a, b) => { const left = JSON.stringify(a), right = JSON.stringify(b); return left < right ? -1 : left > right ? 1 : 0; }), missing: [...snapshot.missing].sort() });
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
