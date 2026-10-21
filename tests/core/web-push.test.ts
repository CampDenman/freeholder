// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.22: standard Web Push with the site's own keys, and quiet hours that
// hold push and email until they end.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from "node:crypto";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { db } from "@/core/db";
import { notificationDeliveries, webPushSubscriptions } from "@/core/notifications/schema";
import {
  afterQuietHours,
  createNotification,
  deliverDueNotifications,
  subscribeWebPush,
  updateNotificationSettings,
} from "@/core/notifications/service";
import { acceptablePushEndpoint, encryptPayload, sendWebPush } from "@/core/notifications/web-push";
import { closeDb, CUSTOMER, failure, hasDatabase, truncateSpine } from "../helpers/spine";

const SYSTEM = { kind: "system" } as const;

function browser() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") };
}

/** What a browser does with an aes128gcm push message (RFC 8291 / RFC 8188). */
function decrypt(body: Buffer, ua: ReturnType<typeof browser>): string {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  const shared = ua.ecdh.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), ua.ecdh.getPublicKey(), asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, Buffer.from(ua.auth, "base64url"), info, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(-16));
  const padded = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  expect(padded.at(-1)).toBe(2);
  return padded.subarray(0, -1).toString("utf8");
}

describe("web push protocol", () => {
  it("encrypts so only the subscribing browser can read the payload", () => {
    const ua = browser();
    const body = encryptPayload(Buffer.from('{"title":"Hi"}'), ua.p256dh, ua.auth);
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(decrypt(body, ua)).toBe('{"title":"Hi"}');
  });

  it("only accepts the browsers' own push services as endpoints", () => {
    expect(acceptablePushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(acceptablePushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(acceptablePushEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(acceptablePushEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    expect(acceptablePushEndpoint("https://169.254.169.254/latest")).toBe(false);
    expect(acceptablePushEndpoint("https://fcm.googleapis.com.evil.test/x")).toBe(false);
    expect(acceptablePushEndpoint("https://localhost/x")).toBe(false);
  });

  it("signs a VAPID token the push service can verify with the site's public key", async () => {
    const site = createECDH("prime256v1");
    site.generateKeys();
    const keys = { publicKey: site.getPublicKey().toString("base64url"), privateKey: site.getPrivateKey().toString("base64url") };
    const ua = browser();
    let seen: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const outcome = await sendWebPush({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: ua.p256dh, auth: ua.auth }, keys, { title: "Hi", body: "There" }, fake);
    expect(outcome).toBe("delivered");
    const headers = seen!.init.headers as Record<string, string>;
    expect(headers["content-encoding"]).toBe("aes128gcm");
    const [, token, key] = /^vapid t=([^,]+), k=(.+)$/.exec(headers.authorization!)!;
    expect(key).toBe(keys.publicKey);
    const [h, c, sig] = token!.split(".");
    expect((JSON.parse(Buffer.from(c!, "base64url").toString()) as { aud: string }).aud).toBe("https://fcm.googleapis.com");
    const raw = site.getPublicKey();
    const publicKey = createPublicKey({ key: { kty: "EC", crv: "P-256", x: raw.subarray(1, 33).toString("base64url"), y: raw.subarray(33).toString("base64url") }, format: "jwk" });
    expect(verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig!, "base64url"))).toBe(true);
    expect(decrypt(Buffer.from(seen!.init.body as Uint8Array), ua)).toBe('{"title":"Hi","body":"There"}');
  });
});

describe("quiet hours", () => {
  const base = { digestCadence: "daily" as const, digestMinute: 480, digestWeekday: 1, timezone: "America/Vancouver", escalationMinutes: 60 };
  it("holds until the window ends, including across midnight", () => {
    const late = new Date("2026-08-12T06:30:00.000Z"); // 23:30 Vancouver (UTC-7)
    expect(afterQuietHours(late, { ...base, quietStartMinute: 22 * 60, quietEndMinute: 7 * 60 }).toISOString()).toBe("2026-08-12T14:00:00.000Z");
    const early = new Date("2026-08-12T12:00:00.000Z"); // 05:00 Vancouver
    expect(afterQuietHours(early, { ...base, quietStartMinute: 22 * 60, quietEndMinute: 7 * 60 }).toISOString()).toBe("2026-08-12T14:00:00.000Z");
    const noon = new Date("2026-08-12T19:00:00.000Z");
    expect(afterQuietHours(noon, { ...base, quietStartMinute: 22 * 60, quietEndMinute: 7 * 60 })).toEqual(noon);
    expect(afterQuietHours(noon, base)).toEqual(noon);
  });
});

describe.runIf(hasDatabase)("web push delivery", () => {
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values({ id: CUSTOMER.userId, email: "rae@example.test", role: "customer" });
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await truncateSpine();
    await closeDb();
  });

  const note = () => ({
    recipient: { kind: "user" as const, id: CUSTOMER.userId },
    topic: "members.follow",
    priority: "information" as const,
    title: "Sam followed you",
    body: "@sam started following you.",
    href: "/@sam",
    idempotencyKey: `test:${crypto.randomUUID()}`,
  });

  it("subscribes, delivers to the browser, and drops a subscription the browser abandoned", async () => {
    const ua = browser();
    expect((await failure(subscribeWebPush.call({ endpoint: "https://evil.test/push", p256dh: ua.p256dh, auth: ua.auth }, CUSTOMER))).code).toBe("validation");
    await subscribeWebPush.call({ endpoint: "https://fcm.googleapis.com/fcm/send/rae", p256dh: ua.p256dh, auth: ua.auth }, CUSTOMER);

    const sent: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((async (url: string, init: RequestInit) => {
      sent.push(decrypt(Buffer.from(init.body as Uint8Array), ua));
      return new Response(null, { status: sent.length === 1 ? 201 : 410 });
    }) as unknown as typeof fetch);

    await createNotification.call(note(), SYSTEM);
    await deliverDueNotifications();
    expect(JSON.parse(sent[0]!)).toMatchObject({ title: "Sam followed you" });
    const [push] = await db().select().from(notificationDeliveries).where(eq(notificationDeliveries.channel, "push"));
    expect(push).toMatchObject({ status: "delivered", provider: "web-push" });

    await createNotification.call(note(), SYSTEM);
    await deliverDueNotifications();
    expect(await db().select().from(webPushSubscriptions)).toEqual([]);
  });

  it("holds push and email during quiet hours but not critical items", async () => {
    const ua = browser();
    await subscribeWebPush.call({ endpoint: "https://fcm.googleapis.com/fcm/send/rae", p256dh: ua.p256dh, auth: ua.auth }, CUSTOMER);
    const now = new Date();
    const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
    await updateNotificationSettings.call({
      digestCadence: "daily", digestMinute: 480, digestWeekday: 1, timezone: "UTC", escalationMinutes: 60,
      quietStartMinute: (minute + 1440 - 60) % 1440, quietEndMinute: (minute + 60) % 1440,
    }, CUSTOMER);
    await createNotification.call(note(), SYSTEM);
    const [held] = await db().select().from(notificationDeliveries).where(eq(notificationDeliveries.channel, "push"));
    expect(held!.availableAt.getTime()).toBeGreaterThan(now.getTime() + 50 * 60_000);

    await createNotification.call({ ...note(), topic: "connections.attention", priority: "critical" as const }, SYSTEM);
    const pushes = await db().select().from(notificationDeliveries).where(eq(notificationDeliveries.channel, "push"));
    expect(pushes.some((d) => d.availableAt.getTime() <= Date.now())).toBe(true);
    expect((await failure(updateNotificationSettings.call({ digestCadence: "daily", digestMinute: 480, digestWeekday: 1, timezone: "UTC", escalationMinutes: 60, quietStartMinute: 60, quietEndMinute: null }, CUSTOMER))).code).toBe("validation");
  });
});
