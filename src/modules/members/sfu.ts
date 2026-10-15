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
}

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/** LiveKit (self-hosted, Apache-2.0): an HS256 access token with a room grant. */
export function liveKit(url: string, apiKey: string, apiSecret: string): SfuAdapter {
  return {
    id: "livekit",
    url,
    issue({ room, identity, name, ttlSeconds }) {
      const now = Math.floor(Date.now() / 1000);
      const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
      const claims = base64url(
        JSON.stringify({
          iss: apiKey,
          sub: identity,
          name,
          nbf: now - 10,
          exp: now + ttlSeconds,
          video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false, canUpdateOwnMetadata: false },
        }),
      );
      const signature = createHmac("sha256", apiSecret).update(`${header}.${claims}`).digest("base64url");
      return `${header}.${claims}.${signature}`;
    },
  };
}

/** The configured SFU, or null when the site has none. */
export function sfu(): SfuAdapter | null {
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = env();
  return LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET ? liveKit(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET) : null;
}
