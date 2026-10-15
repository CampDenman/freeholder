// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Standard Web Push (C12.22): RFC 8030 delivery, RFC 8291 message encryption
// (aes128gcm, RFC 8188) and RFC 8292 VAPID, with the site's own key pair.
//
// No push vendor account is involved: the payload is encrypted to the
// browser's keys here and handed to that browser's own push service, which
// cannot read it. Only the major browsers' push services are accepted as
// endpoints, because the server POSTs to the URL a browser hands it.
import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from "node:crypto";
import { eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "@/core/connections/crypto";
import { env } from "@/core/env";
import type { Tx } from "@/core/service";
import { webPushKeys, webPushSubscriptions } from "./schema";

const KEY_AAD = "freeholder:web-push:vapid:v1";
const RECORD_SIZE = 4096;

/** Push services of the browsers people use; anything else is refused. */
const PUSH_HOSTS = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "web.push.apple.com",
  "notify.windows.com",
];

export function acceptablePushEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

const b64u = (value: Buffer | Uint8Array) => Buffer.from(value).toString("base64url");

/** The site's VAPID key pair, created once. */
export async function vapidKeys(tx: Tx): Promise<{ publicKey: string; privateKey: string }> {
  const [found] = await tx.select().from(webPushKeys).where(eq(webPushKeys.id, 1));
  if (found) return { publicKey: found.publicKey, privateKey: decryptSecret(found.privateKeySealed, KEY_AAD) };
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const publicKey = b64u(ecdh.getPublicKey());
  const privateKey = b64u(ecdh.getPrivateKey());
  await tx.insert(webPushKeys).values({ id: 1, publicKey, privateKeySealed: encryptSecret(privateKey, KEY_AAD) }).onConflictDoNothing();
  // A concurrent first request may have won; the stored pair is the truth.
  const [stored] = await tx.select().from(webPushKeys).where(eq(webPushKeys.id, 1));
  return { publicKey: stored!.publicKey, privateKey: decryptSecret(stored!.privateKeySealed, KEY_AAD) };
}

function vapidJwt(endpoint: string, keys: { publicKey: string; privateKey: string }): string {
  const publicRaw = Buffer.from(keys.publicKey, "base64url");
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: b64u(publicRaw.subarray(1, 33)),
    y: b64u(publicRaw.subarray(33, 65)),
    d: keys.privateKey,
  };
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(Buffer.from(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: env().APP_URL,
  })));
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), {
    key: createPrivateKey({ key: jwk, format: "jwk" }),
    dsaEncoding: "ieee-p1363",
  });
  return `${header}.${claims}.${b64u(signature)}`;
}

/** RFC 8291: encrypt one payload to a browser's p256dh and auth secret. */
export function encryptPayload(payload: Uint8Array, p256dh: string, auth: string): Buffer {
  const uaPublic = Buffer.from(p256dh, "base64url");
  const authSecret = Buffer.from(auth, "base64url");
  const ecdh = createECDH("prime256v1");
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, authSecret, keyInfo, 32));
  const salt = randomBytes(16);
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // A single record: the payload, then the last-record delimiter.
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

export type WebPushOutcome = "delivered" | "gone" | "failed";

/** Send one notification to one subscription. Provider I/O: never call inside a transaction. */
export async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  keys: { publicKey: string; privateKey: string },
  message: { title: string; body: string; href?: string; tag?: string },
  fetcher: typeof fetch = fetch,
): Promise<WebPushOutcome> {
  if (!acceptablePushEndpoint(subscription.endpoint)) return "gone";
  const body = encryptPayload(Buffer.from(JSON.stringify(message)), subscription.p256dh, subscription.auth);
  const response = await fetcher(subscription.endpoint, {
    method: "POST",
    headers: {
      authorization: `vapid t=${vapidJwt(subscription.endpoint, keys)}, k=${keys.publicKey}`,
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(24 * 60 * 60),
      urgency: "normal",
    },
    body: new Uint8Array(body),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  // 404/410: the browser dropped this subscription; stop sending to it.
  if (response.status === 404 || response.status === 410) return "gone";
  return response.ok ? "delivered" : "failed";
}

export async function subscriptionsFor(tx: Tx, userId: string) {
  return tx.select().from(webPushSubscriptions).where(eq(webPushSubscriptions.userId, userId));
}
