// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.13: inbound Paradise Comms relay. Raw body, signature verification, then
// exactly one idempotent state-machine apply — the same order as the payment
// webhook boundary.
import { RequestBodyError, readBoundedBytes } from "@/core/http/body";
import { ServiceError } from "@/core/service";
import { applyParadiseWebhook, parseParadiseWebhook, ParadiseWebhookError, verifyParadiseSignature } from "../../../../../../plugins/voice-video/webhook";
import { readVoiceVideoSettings, resolveParadiseConfig } from "../../../../../../plugins/voice-video/settings";

const MAX_WEBHOOK_BYTES = 1_048_576;

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readBoundedBytes(request, MAX_WEBHOOK_BYTES);
    const headers = Object.fromEntries([...request.headers.entries()].map(([key, value]) => [key.toLowerCase(), value]));
    const eventName = headers["webhook-event"];
    const deliveryId = headers["webhook-delivery-id"];
    if (!eventName || !deliveryId) {
      return Response.json({ error: "Missing Webhook-Event or Webhook-Delivery-Id header." }, { status: 400 });
    }
    const { settings } = await readVoiceVideoSettings();
    const config = resolveParadiseConfig(settings);
    if (!config.webhookSecret) {
      // Fail closed: without the relay secret nothing can be verified. PM
      // retries on the 500, and the setup screen names what is missing.
      return Response.json({ error: "No Paradise Comms webhook secret is configured on this instance." }, { status: 500 });
    }
    verifyParadiseSignature({ secret: config.webhookSecret, signatureHeader: headers["webhook-signature"] ?? null, body });
    const event = parseParadiseWebhook(body);
    if (event.type !== eventName) {
      return Response.json({ error: "Webhook-Event header does not match the envelope." }, { status: 400 });
    }
    const result = await applyParadiseWebhook.call({ event, deliveryId }, { kind: "system" });
    return Response.json(result);
  } catch (error) {
    if (error instanceof RequestBodyError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof ParadiseWebhookError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof ServiceError) return Response.json({ error: error.message }, { status: 422 });
    console.error("paradise comms webhook processing failed", error);
    return Response.json({ error: "Paradise Comms feedback could not be processed." }, { status: 500 });
  }
}
