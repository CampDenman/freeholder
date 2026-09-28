// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.13: inbound Paradise Comms relay — signature verification, replay
// rejection and state-machine mapping. No real network: the route handler is
// invoked with Request objects and the PM server is mocked memory state.
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { createContact } from "@/core/contacts/service";
import { stopJobs } from "@/core/jobs";
import { parseParadiseWebhook, ParadiseWebhookError, verifyParadiseSignature } from "../../plugins/voice-video/webhook";
import { configureVoiceVideo } from "../../plugins/voice-video/service";
import { voiceVideoArtifacts, voiceVideoRooms } from "../../plugins/voice-video/schema";
import { POST } from "../../app/api/plugins/voice-video/webhooks/paradise/route";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const SECRET = "whsec_test_secret_0123456789abcdef";
const providerRoomId = "rm_01J8ZQ6KM2B1T0ABCDEFGHJ5K9";
const recordingId = "rec_01J8ZQ6KM2B1T0ABCDEFGHJ5K9";

function sign(body: string, timestamp = Math.floor(Date.now() / 1000)) {
  const mac = createHmac("sha256", SECRET).update(`${timestamp}.${body}`).digest("hex");
  return { signature: `t=${timestamp},v1=${mac}`, timestamp: String(timestamp) };
}

function envelope(input: { id: string; type: string; resourceType: string; resourceId: string; data?: Record<string, unknown> }) {
  return JSON.stringify({
    id: input.id, type: input.type, occurred_at: "2026-09-28T00:00:00.000Z", tenant: "demo",
    resource_type: input.resourceType, resource_id: input.resourceId, data: input.data ?? {},
  });
}

function relayRequest(body: string, options: { signature?: string | null; event?: string; deliveryId?: string } = {}) {
  const signed = sign(body);
  const envelopeType = (JSON.parse(body) as { type: string }).type;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Webhook-Event": options.event ?? envelopeType,
    "Webhook-Delivery-Id": options.deliveryId ?? randomUUID(),
    "Webhook-Timestamp": signed.timestamp,
    "Webhook-Tenant": "demo",
  };
  if (options.signature !== null) headers["Webhook-Signature"] = options.signature ?? signed.signature;
  return new Request("https://freeholder.test/api/plugins/voice-video/webhooks/paradise", { method: "POST", headers, body });
}

describe("Paradise Comms webhook signature verification", () => {
  it("accepts a correctly signed delivery and returns its timestamp", () => {
    const ts = Math.floor(Date.now() / 1000);
    expect(verifyParadiseSignature({ secret: SECRET, signatureHeader: sign("hello", ts).signature, body: new TextEncoder().encode("hello") })).toBe(ts);
  });

  it("rejects bad signatures, wrong secrets, malformed headers and stale timestamps", () => {
    const body = new TextEncoder().encode("hello");
    const good = sign("hello");
    expect(() => verifyParadiseSignature({ secret: SECRET, signatureHeader: good.signature, body: new TextEncoder().encode("tampered") }))
      .toThrow(ParadiseWebhookError);
    expect(() => verifyParadiseSignature({ secret: "whsec_wrong", signatureHeader: good.signature, body }))
      .toThrow("does not match");
    expect(() => verifyParadiseSignature({ secret: SECRET, signatureHeader: null, body })).toThrow("Missing");
    expect(() => verifyParadiseSignature({ secret: SECRET, signatureHeader: "v1=abc", body })).toThrow("Malformed");
    expect(() => verifyParadiseSignature({ secret: SECRET, signatureHeader: sign("hello", Math.floor(Date.now() / 1000) - 3600).signature, body }))
      .toThrow("outside the allowed window");
    expect(() => verifyParadiseSignature({ secret: SECRET, signatureHeader: sign("hello", Math.floor(Date.now() / 1000) + 3600).signature, body }))
      .toThrow("outside the allowed window");
  });

  it("parses and rejects PM envelopes honestly", () => {
    const body = envelope({ id: "evt_1", type: "stream.ended", resourceType: "room", resourceId: providerRoomId });
    expect(parseParadiseWebhook(new TextEncoder().encode(body))).toMatchObject({ type: "stream.ended", resource_id: providerRoomId });
    expect(() => parseParadiseWebhook(new TextEncoder().encode("not json"))).toThrow("not valid JSON");
    expect(() => parseParadiseWebhook(new TextEncoder().encode(JSON.stringify({ id: "evt_1" })))).toThrow("envelope");
  });
});

describe.runIf(hasDatabase)("Paradise Comms webhook route and mapping", { timeout: 30_000 }, () => {
  beforeEach(async () => { await ready(); await truncateSpine(); });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => { await stopJobs(); await closeDb(); });

  async function seed() {
    const contact = await createContact.call({ name: "Webhook person", email: `${randomUUID()}@example.test` }, OWNER);
    await configureVoiceVideo.call({ provider: "paradise", paradise: { apiKey: "pm-key", webhookSecret: SECRET } }, OWNER);
    return contact;
  }

  it("rejects deliveries when no webhook secret is configured", async () => {
    const body = envelope({ id: "evt_1", type: "stream.ended", resourceType: "room", resourceId: providerRoomId });
    const response = await POST(relayRequest(body));
    expect(response.status).toBe(500);
    const payload = await response.json() as { error: string };
    expect(payload.error).toContain("webhook secret");
  });

  it("rejects bad signatures and mismatched event headers without touching state", async () => {
    await seed();
    const body = envelope({ id: "evt_1", type: "stream.ended", resourceType: "room", resourceId: providerRoomId });
    const bad = await POST(relayRequest(body, { signature: sign("forged body").signature }));
    expect(bad.status).toBe(400);
    const mismatched = await POST(relayRequest(body, { event: "stream.created" }));
    expect(mismatched.status).toBe(400);
  });

  it("closes a live paradise room on room-ended and de-duplicates redeliveries", async () => {
    const contact = await seed();
    const [room] = await db().insert(voiceVideoRooms).values({ contactId: contact.id, kind: "video", provider: "paradise",
      title: "Webhook call", status: "live", externalRef: providerRoomId }).returning();
    const body = envelope({ id: "evt_room_end", type: "stream.ended", resourceType: "room", resourceId: providerRoomId });
    const first = await POST(relayRequest(body, { deliveryId: "d1" }));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ action: "room-ended" });
    const [closed] = await db().select().from(voiceVideoRooms).where(eq(voiceVideoRooms.id, room!.id));
    expect(closed!.status).toBe("ended");
    // PM retries with a new delivery id for the same event: no re-close, no error.
    const replay = await POST(relayRequest(body, { deliveryId: "d2" }));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ action: "duplicate" });
  });

  it("ignores events for unknown resources and unmapped event types", async () => {
    await seed();
    const unknown = await POST(relayRequest(envelope({ id: "evt_unknown", type: "stream.ended", resourceType: "room", resourceId: "rm_01J8ZQ6KM2B1T0ABCDEFGHJ5ZZ" })));
    expect(await unknown.json()).toMatchObject({ action: "ignored" });
    const unmapped = await POST(relayRequest(envelope({ id: "evt_publish", type: "stream.publish.start", resourceType: "room", resourceId: providerRoomId })));
    expect(await unmapped.json()).toMatchObject({ action: "ignored" });
  });

  it("drops local provider references when PM reports a recording deleted or expired", async () => {
    const contact = await seed();
    const [room] = await db().insert(voiceVideoRooms).values({ contactId: contact.id, kind: "video", provider: "paradise",
      title: "Recorded call", status: "ended", externalRef: providerRoomId }).returning();
    const [imported] = await db().insert(voiceVideoArtifacts).values({ contactId: contact.id, roomId: room!.id, kind: "video",
      provider: "paradise", title: "Imported copy", status: "recorded", externalRef: recordingId,
      importStatus: "imported", storageKey: "key-1" }).returning();
    const [localOnly] = await db().insert(voiceVideoArtifacts).values({ contactId: contact.id, roomId: room!.id, kind: "video",
      provider: "paradise", title: "Provider-only copy", status: "recorded", externalRef: recordingId }).returning();
    const body = envelope({ id: "evt_rec_delete", type: "recording.deleted", resourceType: "recording", resourceId: recordingId, data: { reason: "deleted" } });
    const response = await POST(relayRequest(body));
    expect(await response.json()).toMatchObject({ action: "recording-dropped" });
    const [afterImported] = await db().select().from(voiceVideoArtifacts).where(eq(voiceVideoArtifacts.id, imported!.id));
    expect(afterImported).toMatchObject({ externalRef: null, status: "recorded", storageKey: "key-1" });
    expect(afterImported!.lastError).toContain("erased this recording");
    const [afterLocal] = await db().select().from(voiceVideoArtifacts).where(eq(voiceVideoArtifacts.id, localOnly!.id));
    expect(afterLocal).toMatchObject({ externalRef: null, status: "failed" });
  });
});
