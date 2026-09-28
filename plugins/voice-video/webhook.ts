// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.13: inbound Paradise Comms webhook relay. PM signs each delivery
// (Webhook-Signature: t=<unix>,v1=<hex hmac-sha256(secret, "<ts>.<body>")>)
// and consumers de-dupe on the envelope id. Verification precedes every
// database effect, exactly like the payment webhook boundary.
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { defineService } from "@/core/service";
import { voiceVideoArtifacts, voiceVideoRooms, voiceVideoWebhookDeliveries } from "./schema";

/** Deliveries older or newer than this window are rejected (clock skew). */
export const PARADISE_WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

export class ParadiseWebhookError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = "ParadiseWebhookError"; }
}

/**
 * Verify a PM relay delivery. The signed string is "<timestamp>.<raw body>";
 * the signature header carries both parts (`t=…,v1=…`) and the comparison is
 * constant-time. Throws ParadiseWebhookError on any mismatch.
 */
export function verifyParadiseSignature(input: {
  secret: string;
  signatureHeader: string | null;
  body: Uint8Array;
  now?: number;
}): number {
  const header = input.signatureHeader;
  if (!header) throw new ParadiseWebhookError("Missing Webhook-Signature header.");
  const parts = new Map<string, string>();
  for (const token of header.split(",")) {
    const index = token.indexOf("=");
    if (index > 0) parts.set(token.slice(0, index).trim(), token.slice(index + 1).trim());
  }
  const timestamp = parts.get("t");
  const signature = parts.get("v1");
  if (!timestamp || !/^\d{9,12}$/.test(timestamp) || !signature || !/^[0-9a-f]{64}$/.test(signature)) {
    throw new ParadiseWebhookError("Malformed Webhook-Signature header.");
  }
  const tsMs = Number(timestamp) * 1000;
  if (Math.abs((input.now ?? Date.now()) - tsMs) > PARADISE_WEBHOOK_TOLERANCE_MS) {
    throw new ParadiseWebhookError("Webhook timestamp is outside the allowed window.");
  }
  const expected = createHmac("sha256", input.secret).update(`${timestamp}.`).update(input.body).digest("hex");
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    throw new ParadiseWebhookError("Webhook signature does not match.");
  }
  return Number(timestamp);
}

const webhookEventSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.string().min(1).max(100),
  occurred_at: z.string().max(40),
  tenant: z.string().max(64),
  resource_type: z.string().max(32),
  resource_id: z.string().min(1).max(64),
  data: z.record(z.string(), z.unknown()),
});

export type ParadiseWebhookEvent = z.infer<typeof webhookEventSchema>;

export function parseParadiseWebhook(body: Uint8Array): ParadiseWebhookEvent {
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(body)); } catch {
    throw new ParadiseWebhookError("Webhook body is not valid JSON.");
  }
  const result = webhookEventSchema.safeParse(parsed);
  if (!result.success) throw new ParadiseWebhookError("Webhook body does not match the Paradise Comms envelope.");
  return result.data;
}

const ROOM_ENDED_TYPES = new Set(["stream.ended", "room.ended", "call.ended"]);
const RECORDING_DROPPED_TYPES = new Set(["recording.deleted", "recording.expired"]);

/**
 * Apply one verified PM event to the plugin's state machine. Idempotent by
 * envelope id: a redelivery (PM retries for up to 24h) is recorded once and
 * reports `duplicate` without re-touching room or recording rows.
 */
export const applyParadiseWebhook = defineService({
  name: "voiceVideo.applyParadiseWebhook",
  summary: "Apply one verified Paradise Comms relay event to local room and recording state.",
  kind: "mutation", permission: "system", external: false, writeClass: "write",
  input: z.object({
    event: webhookEventSchema,
    deliveryId: z.string().min(1).max(64),
  }),
  output: z.object({ ok: z.literal(true), action: z.enum(["room-ended", "recording-dropped", "ignored", "duplicate"]) }),
  handler: async (input, ctx) => {
    const { event, deliveryId } = input;
    const [recorded] = await ctx.tx.insert(voiceVideoWebhookDeliveries).values({
      eventId: event.id, deliveryId, eventType: event.type, resourceId: event.resource_id, action: "received",
    }).onConflictDoNothing().returning();
    if (!recorded) return { ok: true as const, action: "duplicate" as const };

    let action: "room-ended" | "recording-dropped" | "ignored" = "ignored";
    if (ROOM_ENDED_TYPES.has(event.type) && (event.resource_type === "room" || event.resource_type === "call" || event.resource_type === "stream")) {
      // PM's LiveKit translation currently emits stream.ended for every
      // resource family; accept the room-family spellings too so a relay
      // catalog change never strands live rooms.
      const [room] = await ctx.tx.select().from(voiceVideoRooms)
        .where(eq(voiceVideoRooms.externalRef, event.resource_id)).limit(1).for("update");
      if (room && room.provider === "paradise" && ["live", "stopping", "pending"].includes(room.status)) {
        await ctx.tx.update(voiceVideoRooms).set({ status: "ended", lastError: null,
          providerLeaseToken: null, providerLeaseExpiresAt: null }).where(eq(voiceVideoRooms.id, room.id));
        ctx.queueEvent("voiceVideo.roomEnded", { id: room.id });
        action = "room-ended";
      }
    } else if (RECORDING_DROPPED_TYPES.has(event.type) && event.resource_type === "recording") {
      const recordings = await ctx.tx.select().from(voiceVideoArtifacts)
        .where(eq(voiceVideoArtifacts.externalRef, event.resource_id)).for("update");
      for (const artifact of recordings) {
        if (artifact.provider !== "paradise") continue;
        // The provider original is gone: drop the local reference so no
        // provider call chases a dead id. An imported owner-storage copy is
        // the owner's asset and keeps its recorded state; a recording that
        // never imported has nothing left anywhere and fails honestly.
        await ctx.tx.update(voiceVideoArtifacts).set({
          externalRef: null,
          status: artifact.importStatus === "imported" ? artifact.status : "failed",
          lastError: `The call provider erased this recording (${event.type}).`,
        }).where(eq(voiceVideoArtifacts.id, artifact.id));
      }
      action = recordings.length ? "recording-dropped" : "ignored";
    }

    await ctx.tx.update(voiceVideoWebhookDeliveries).set({ action }).where(eq(voiceVideoWebhookDeliveries.id, recorded.id));
    return { ok: true as const, action };
  },
});
