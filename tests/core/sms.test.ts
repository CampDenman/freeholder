// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Sending and receiving text messages (C7.10, MASTER.md §4.14, §12).
//
// The adapter transports; core decides. Each half has its own way of going
// wrong, and the tests are split along that line.
//
// **The adapter.** Twilio's webhook signature is its own scheme — the full
// request URL followed by every POSTed parameter sorted by key, concatenated
// as key+value with no separators, HMAC-SHA1 with the auth token. Every part of
// that is a chance to be subtly wrong in a way that looks exactly like an
// attack, so it is tested against a signature computed independently.
//
// **Core.** Which number a message goes out on is a decision with consequences:
// §4.14 keeps transactional and marketing apart because consent does, and a
// number carriers are filtering must not be used. And every inbound message
// goes through the same door as email and forms, so a text from a stranger
// becomes a real contact on a real thread (C7.08).
import { createHmac } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { assets } from "@/core/media/schema";
import { conversations, messageDeliveries, messages } from "@/core/messaging/schema";
import { messagingNumbers } from "@/core/messaging/numbers-schema";
import { createTwilioSms } from "@/adapters/sms/twilio";
import { AdapterError } from "@/adapters/types";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import {
  applySmsEvents,
  checkNumberHealth,
  importMessagingNumbers,
  listMessagingNumbers,
  sendSms,
  updateMessagingNumber,
} from "@/core/messaging/sms";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const TOKEN = "test-auth-token";
const URL = "https://example.test/api/sms/webhooks/twilio";

/** An IANA fixed-offset zone whose current local hour is always noon. */
function daytimeTimezone(): string {
  let offset = 12 - new Date().getUTCHours();
  if (offset > 12) offset -= 24;
  if (offset < -12) offset += 24;
  if (offset === 0) return "UTC";
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

/** Twilio's scheme, computed here independently of the adapter's copy. */
function sign(url: string, params: Record<string, string>, token = TOKEN): string {
  const signed = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", token).update(signed, "utf8").digest("base64");
}

function callback(params: Record<string, string>, signature?: string) {
  const body = new URLSearchParams(params).toString();
  return {
    headers: { "x-twilio-signature": signature ?? sign(URL, params) },
    body: new Uint8Array(Buffer.from(body, "utf8")),
    receivedAt: "2026-08-23T09:00:00.000Z",
  };
}

describe("the Twilio edge", () => {
  const adapter = createTwilioSms({
    accountSid: "AC-test",
    authToken: TOKEN,
    from: "+15005550006",
    webhookUrl: URL,
    fetch: async () =>
      new Response(
        JSON.stringify({
          sid: "SM-1",
          num_segments: "2",
          price: "-0.0158",
          price_unit: "USD",
        }),
        { status: 201 },
      ),
  });

  it("says plainly when it has no credentials", () => {
    const bare = createTwilioSms();
    expect(bare.available).toBe(false);
    expect(bare.status.message).toContain("account SID");
  });

  it("reads an inbound message out of a signed callback", async () => {
    const events = await adapter.verifyWebhook(
      callback({
        MessageSid: "SM-inbound",
        From: "+447700900123",
        To: "+15005550006",
        Body: "Are you open Saturday?",
        NumMedia: "0",
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "received",
      providerRef: "SM-inbound",
      from: "+447700900123",
      body: "Are you open Saturday?",
    });
  });

  it("reads a picture message's media", async () => {
    const events = await adapter.verifyWebhook(
      callback({
        MessageSid: "SM-mms",
        From: "+447700900123",
        Body: "",
        NumMedia: "2",
        MediaUrl0: "https://api.twilio.test/one.jpg",
        MediaUrl1: "https://api.twilio.test/two.jpg",
      }),
    );
    expect(events[0]!.mediaUrls).toEqual([
      "https://api.twilio.test/one.jpg",
      "https://api.twilio.test/two.jpg",
    ]);
  });

  it("downloads inbound media only from the authenticated provider origin", async () => {
    const png = new Uint8Array(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z8nAAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    let authorization = "";
    const mediaAdapter = createTwilioSms({
      accountSid: "AC-test",
      authToken: TOKEN,
      apiBase: "https://api.twilio.test/2010-04-01",
      fetch: async (_url, init) => {
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return new Response(png, {
          status: 200,
          headers: { "content-type": "image/png", "content-length": String(png.byteLength) },
        });
      },
    });
    const downloaded = await mediaAdapter.downloadMedia!(
      "https://api.twilio.test/2010-04-01/Accounts/AC/Messages/SM/Media/ME",
    );
    expect(downloaded).toMatchObject({ filename: "ME.png", contentType: "image/png" });
    expect(downloaded.bytes).toEqual(png);
    expect(authorization).toMatch(/^Basic /);
    await expect(
      mediaAdapter.downloadMedia!("https://attacker.example/steal"),
    ).rejects.toBeInstanceOf(AdapterError);
  });

  it("reads a delivery report, keeping the carrier's own code", async () => {
    const events = await adapter.verifyWebhook(
      callback({
        MessageSid: "SM-1",
        MessageStatus: "undelivered",
        ErrorCode: "30003",
        ErrorMessage: "Unreachable destination handset",
      }),
    );
    expect(events[0]).toMatchObject({
      kind: "undelivered",
      providerRef: "SM-1",
      errorCode: "30003",
    });
  });

  // A signature that does not match is an attack until proven otherwise.
  it("refuses a callback signed with the wrong token", async () => {
    const forged = callback({ MessageSid: "SM-1", MessageStatus: "delivered" }, sign(URL, { MessageSid: "SM-1", MessageStatus: "delivered" }, "wrong-token"));
    await expect(adapter.verifyWebhook(forged)).rejects.toBeInstanceOf(AdapterError);
  });

  it("refuses a callback whose body was changed after signing", async () => {
    const honest = { MessageSid: "SM-1", MessageStatus: "delivered" };
    const signature = sign(URL, honest);
    const tampered = callback({ ...honest, MessageStatus: "failed" }, signature);
    await expect(adapter.verifyWebhook(tampered)).rejects.toBeInstanceOf(AdapterError);
  });

  it("refuses a callback with no signature at all", async () => {
    await expect(
      adapter.verifyWebhook({
        headers: {},
        body: new Uint8Array(Buffer.from("MessageSid=SM-1")),
        receivedAt: "2026-08-23T09:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(AdapterError);
  });

  // The URL is part of the signed string, so a proxy that rewrites it breaks
  // verification — which is why it is configured rather than inferred.
  it("refuses when it does not know the URL Twilio called", async () => {
    const blind = createTwilioSms({ accountSid: "AC", authToken: TOKEN });
    await expect(
      blind.verifyWebhook(callback({ MessageSid: "SM-1", MessageStatus: "sent" })),
    ).rejects.toBeInstanceOf(AdapterError);
  });

  it("reports what a send cost, in minor units", async () => {
    const result = await adapter.send({
      to: "+447700900123",
      title: "",
      body: "Two segments' worth of message",
      deliveryId: "idem-1",
    });
    expect(result).toMatchObject({
      providerRef: "SM-1",
      delivers: true,
      segments: 2,
      // "-0.0158" is a debit of just over one and a half cents.
      costMinor: 2,
      costCurrency: "USD",
    });
  });

  it("will not send with nothing to send from", async () => {
    const homeless = createTwilioSms({
      accountSid: "AC",
      authToken: TOKEN,
      fetch: async () => new Response("{}", { status: 201 }),
    });
    const result = await homeless.send({
      to: "+447700900123",
      title: "",
      body: "Hello",
      deliveryId: "idem-2",
    });
    expect(result).toMatchObject({ delivers: false });
    expect(result.reason).toContain("No number");
  });

  it("passes the provider's own refusal through, without credentials", async () => {
    const refusing = createTwilioSms({
      accountSid: "AC",
      authToken: TOKEN,
      from: "+15005550006",
      fetch: async () =>
        new Response(JSON.stringify({ code: 21610, message: "Attempt to send to unsubscribed recipient" }), {
          status: 400,
        }),
    });
    await expect(
      refusing.send({ to: "+447700900123", title: "", body: "Hi", deliveryId: "idem-3" }),
    ).rejects.toThrow(/21610/);
  });

  it("says a number's health is unknown rather than fine when it cannot ask", async () => {
    const offline = createTwilioSms({
      accountSid: "AC",
      authToken: TOKEN,
      fetch: async () => new Response("nope", { status: 500 }),
    });
    const health = await offline.checkNumber!("PN-1");
    // A green tick nobody verified is exactly the failure §4.14 names.
    expect(health).toMatchObject({ usable: false, unknown: true });
    expect(health.problem).toBeTruthy();
  });
});

describe.runIf(hasDatabase)("text messaging", { timeout: 90_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  }, 60_000);

  afterAll(async () => {
    await truncateSpine();
    await closeDb();
  });

  async function number(overrides: Record<string, unknown> = {}) {
    const [row] = await db()
      .insert(messagingNumbers)
      .values({
        provider: "none",
        providerRef: `PN-${Math.random().toString(36).slice(2, 8)}`,
        e164: "+15005550006",
        country: "US",
        capabilities: { sms: true, mms: false, inbound: true },
        ...overrides,
      })
      .returning();
    return row!;
  }

  it("refuses to send when no provider is configured", async () => {
    await number();
    const [contact] = await db()
      .insert(contacts)
      .values({
        name: "Carrier Test",
        email: "carrier-test@example.test",
        phone: "+447700900123",
        timezone: daytimeTimezone(),
      })
      .returning();
    const refused = await failure(
      sendSms.call(
        {
          contactId: contact!.id,
          to: "+447700900123",
          body: "Hello",
          idempotencyKey: "k1",
        },
        OWNER,
      ),
    );
    // Refused, not queued: a message nobody can send is not a message waiting.
    expect(refused.message).toContain("not configured");
  });

  it("refuses to import numbers with no provider configured", async () => {
    const refused = await failure(importMessagingNumbers.call({}, OWNER));
    expect(refused.message).toContain("not configured");
  });

  it("keeps one default per purpose", async () => {
    const first = await number({ e164: "+15005550001" });
    const second = await number({ e164: "+15005550002" });
    await updateMessagingNumber.call({ id: first.id, isDefault: true }, OWNER);
    await updateMessagingNumber.call({ id: second.id, isDefault: true }, OWNER);

    const listed = await listMessagingNumbers.call({}, OWNER);
    const defaults = listed.filter((one) => one.isDefault);
    // Without this, which number a booking confirmation goes out on becomes
    // whichever the planner returned first.
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.id).toBe(second.id);
  });

  it("lets the same number be default for a different purpose", async () => {
    const transactional = await number({ e164: "+15005550001" });
    const marketing = await number({ e164: "+15005550002" });
    await updateMessagingNumber.call({ id: transactional.id, isDefault: true }, OWNER);
    await updateMessagingNumber.call(
      { id: marketing.id, purpose: "marketing", isDefault: true },
      OWNER,
    );
    const listed = await listMessagingNumbers.call({}, OWNER);
    expect(listed.filter((one) => one.isDefault)).toHaveLength(2);
  });

  it("checks nothing when the provider cannot be asked", async () => {
    await number();
    // The `none` adapter has no health check; the sweep counts the number
    // without inventing an answer for it.
    expect(await checkNumberHealth.call({}, OWNER)).toEqual({ checked: 1, problems: 0 });
  });

  // The whole reason C7.08 was built first.
  it("threads an inbound text onto a real contact", async () => {
    const applied = await applySmsEvents.call(
      {
        events: [
          {
            id: "SM-in",
            kind: "received",
            providerRef: "SM-in",
            from: "+447700900123",
            to: "+15005550006",
            body: "Are you open Saturday?",
            occurredAt: "2026-08-23T09:00:00.000Z",
          },
        ],
      },
      { kind: "system" },
    );
    expect(applied).toEqual({ received: 1, reported: 0 });

    const [made] = await db()
      .select()
      .from(contacts)
      .where(eq(contacts.phone, "+447700900123"));
    expect(made).toBeTruthy();
    const [thread] = await db().select().from(conversations);
    expect(thread).toMatchObject({ contactId: made!.id, replyChannel: "sms", unread: true });
    const [message] = await db().select().from(messages);
    expect(message).toMatchObject({ channel: "sms", direction: "inbound", providerRef: "SM-in" });
  });

  it("records the same inbound text once however often the carrier retries", async () => {
    const event = {
      id: "SM-in",
      kind: "received" as const,
      providerRef: "SM-in",
      from: "+447700900123",
      body: "Hello",
      occurredAt: "2026-08-23T09:00:00.000Z",
    };
    await applySmsEvents.call({ events: [event] }, { kind: "system" });
    await applySmsEvents.call({ events: [event] }, { kind: "system" });
    expect(await db().select().from(messages)).toHaveLength(1);
  });

  it("calls a text with pictures a picture message", async () => {
    const png = new Uint8Array(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z8nAAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    await applySmsEvents.call(
      {
        events: [
          {
            id: "SM-mms",
            kind: "received",
            providerRef: "SM-mms",
            from: "+447700900123",
            body: "",
            media: [
              {
                sourceUrl: "https://api.twilio.test/one.png",
                filename: "one.png",
                contentType: "image/png",
                bytes: png,
              },
            ],
            occurredAt: "2026-08-23T09:00:00.000Z",
          },
        ],
      },
      { kind: "system" },
    );
    const [message] = await db().select().from(messages);
    expect(message!.channel).toBe("mms");
    expect(message!.mediaAssetIds).toHaveLength(1);
    expect(await db().select().from(assets)).toHaveLength(1);
    // A message with no words still needs a body the thread can render.
    expect(message!.body).toBe("(no text)");
  });

  it("records what the carrier said about something it sent", async () => {
    // An outbound message this instance has a record of.
    const { getService } = await import("@/core/service");
    const recorded = (await getService("conversations.record").call(
      {
        phone: "+447700900123",
        direction: "outbound",
        channel: "sms",
        body: "Confirmed",
        providerRef: "SM-out",
      },
      { kind: "system" },
    )) as { message: { id: string } };

    const applied = await applySmsEvents.call(
      {
        events: [
          {
            id: "SM-out:delivered",
            kind: "delivered",
            providerRef: "SM-out",
            segments: 2,
            costMinor: 3,
            costCurrency: "USD",
            occurredAt: "2026-08-23T09:05:00.000Z",
          },
        ],
      },
      { kind: "system" },
    );
    expect(applied).toEqual({ received: 0, reported: 1 });
    const [report] = await db()
      .select()
      .from(messageDeliveries)
      .where(eq(messageDeliveries.messageId, recorded.message.id));
    expect(report!.status).toBe("delivered");
    const [priced] = await db().select().from(messages).where(eq(messages.id, recorded.message.id));
    expect(priced).toMatchObject({ segments: 2, costMinor: 3, costCurrency: "USD" });
  });

  it("marks a hard-invalid recipient and refuses the next send", async () => {
    const [person] = await db()
      .insert(contacts)
      .values({
        name: "Bad Number",
        email: "bad-number@example.test",
        phone: "+15005550199",
        timezone: daytimeTimezone(),
      })
      .returning();
    const { getService } = await import("@/core/service");
    await getService("conversations.record").call(
      {
        contactId: person!.id,
        direction: "outbound",
        channel: "sms",
        body: "Hello",
        sentBy: "system",
        providerRef: "SM-hard-invalid",
        recipientAddress: person!.phone!,
      },
      { kind: "system" },
    );
    await applySmsEvents.call(
      {
        events: [
          {
            id: "SM-hard-invalid:failed",
            kind: "failed",
            providerRef: "SM-hard-invalid",
            errorCode: "21614",
            errorText: "Not a valid mobile number",
            occurredAt: "2026-08-23T09:05:00.000Z",
          },
        ],
      },
      { kind: "system" },
    );
    const [invalid] = await db().select().from(contacts).where(eq(contacts.id, person!.id));
    expect(invalid).toMatchObject({
      phoneStatus: "invalid",
      phoneInvalidProviderCode: "21614",
    });
    const refused = await failure(
      sendSms.call(
        {
          contactId: person!.id,
          to: person!.phone!,
          body: "Retry",
          idempotencyKey: "hard-invalid-retry",
        },
        OWNER,
      ),
    );
    expect(refused.message).toContain("marked invalid");
  });

  it("ignores a report about a message it has no record of", async () => {
    const applied = await applySmsEvents.call(
      {
        events: [
          {
            id: "SM-unknown:delivered",
            kind: "delivered",
            providerRef: "SM-unknown",
            occurredAt: "2026-08-23T09:05:00.000Z",
          },
        ],
      },
      { kind: "system" },
    );
    // Ignored rather than invented: a delivery report about nothing is not a
    // message.
    expect(applied).toEqual({ received: 0, reported: 0 });
    expect(await db().select().from(messageDeliveries)).toHaveLength(0);
  });
});
