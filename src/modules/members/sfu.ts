// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.24 (MASTER.md §2.5, §44.7): the SFU adapter behind group calls.
//
// An adapter turns "this person may join this room" into whatever its server
// accepts. It never sees media keys: those travel between devices inside the
// conversation's MLS group, and frames reach the SFU already encrypted.
import { createHmac } from "node:crypto";
import { env } from "@/core/env";

export interface SfuGrant {
  room: string;
  identity: string;
  name: string;
  ttlSeconds: number;
}

export interface SfuAdapter {
  id: string;
  /** Where the browser connects. */
  url: string;
  /** A short-lived credential for one person in one room. */
  issue(grant: SfuGrant): string;
  /** C12.37: who is connected to a room, by identity. */
  participants(room: string): Promise<string[]>;
  /** C12.37: disconnect one identity from a room. */
  remove(room: string, identity: string): Promise<void>;
}

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/** LiveKit (self-hosted, Apache-2.0): HS256 access tokens, and its room service for admin calls. */
export function liveKit(url: string, apiKey: string, apiSecret: string): SfuAdapter {
  const sign = (claims: Record<string, unknown>) => {
    const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const body = base64url(JSON.stringify(claims));
    return `${header}.${body}.${createHmac("sha256", apiSecret).update(`${header}.${body}`).digest("base64url")}`;
  };
  const http = new URL(url);
  http.protocol = http.protocol === "wss:" ? "https:" : http.protocol === "ws:" ? "http:" : http.protocol;
  const admin = async (method: string, room: string, body: Record<string, unknown>) => {
    const now = Math.floor(Date.now() / 1000);
    const response = await fetch(new URL(`/twirp/livekit.RoomService/${method}`, http), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${sign({ iss: apiKey, nbf: now - 10, exp: now + 60, video: { room, roomAdmin: true } })}` },
      body: JSON.stringify({ room, ...body }),
      signal: AbortSignal.timeout(10_000),
    });
    // A room that already emptied is not an error worth retrying.
    if (response.status === 404) return {};
    if (!response.ok) throw new Error(`LiveKit ${method} failed with ${response.status}.`);
    return (await response.json()) as Record<string, unknown>;
  };
  return {
    id: "livekit",
    url,
    issue({ room, identity, name, ttlSeconds }) {
      const now = Math.floor(Date.now() / 1000);
      return sign({
        iss: apiKey,
        sub: identity,
        name,
        nbf: now - 10,
        exp: now + ttlSeconds,
        video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false, canUpdateOwnMetadata: false },
      });
    },
    async participants(room) {
      const result = await admin("ListParticipants", room, {});
      return ((result.participants as { identity?: string }[] | undefined) ?? []).map((p) => p.identity ?? "").filter(Boolean);
    },
    async remove(room, identity) {
      await admin("RemoveParticipant", room, { identity });
    },
  };
}

let override: SfuAdapter | null | undefined;
/** Tests stand in their own SFU. */
export function setSfuForTests(adapter: SfuAdapter | null | undefined): void {
  override = adapter;
}

/** The configured SFU, or null when the site has none. */
export function sfu(): SfuAdapter | null {
  if (override !== undefined) return override;
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = env();
  return LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET ? liveKit(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET) : null;
}
