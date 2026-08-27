// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The carrier's door (MASTER.md §12, §4.14, C7.10).
//
// The same shape as the payment webhook boundary, and for the same reason:
// **verification precedes every database effect**. The raw bytes are read once
// and handed to the adapter exactly as they arrived — re-encoding a form body
// reorders and re-escapes it, and the signature is over what was actually sent.
//
// What a carrier gets back matters as much as what it sends. A 4xx tells it to
// stop retrying, a 5xx tells it to try again. Getting that backwards either
// loses a customer's text forever or leaves a provider hammering a broken
// instance for a day, so the mapping below is explicit rather than incidental.
import { smsAdapter } from "./sms";
import type { SmsInboundMedia, SmsProviderEvent } from "@/adapters/sms";
import { AdapterError } from "@/adapters/types";
import { getService, ServiceError } from "@/core/service";
import { ready } from "@/core/runtime";

const MAX_WEBHOOK_BYTES = 1_048_576;

class WebhookError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function rawRequest(request: Request): Promise<Uint8Array<ArrayBuffer>> {
  const announced = Number(request.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > MAX_WEBHOOK_BYTES) {
    throw new WebhookError(413, "That callback is too large.");
  }
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > MAX_WEBHOOK_BYTES) {
    throw new WebhookError(413, "That callback is too large.");
  }
  return new Uint8Array(buffer);
}

export function smsWebhookRoute(provider: string) {
  return async (request: Request): Promise<Response> => {
    const receivedAt = new Date().toISOString();
    try {
      // Services are registered lazily, and a route that skips this is the
      // production 500 C6.06 shipped and `route-boot` now guards against.
      await ready();
      const body = await rawRequest(request);
      const headers = Object.fromEntries(
        [...request.headers.entries()].map(([key, value]) => [key.toLowerCase(), value]),
      );
      const adapter = smsAdapter(provider);
      const events = await adapter.verifyWebhook({ headers, body, receivedAt });
      const hydrated: SmsProviderEvent[] = [];
      for (const event of events) {
        if (!event.mediaUrls?.length) {
          hydrated.push(event);
          continue;
        }
        if (!adapter.downloadMedia) {
          throw new AdapterError(
            "sms",
            adapter.id,
            "unavailable",
            "This SMS provider cannot import inbound media.",
          );
        }
        const media: SmsInboundMedia[] = [];
        let totalBytes = 0;
        for (const url of event.mediaUrls) {
          const downloaded = await adapter.downloadMedia(url);
          totalBytes += downloaded.bytes.byteLength;
          if (totalBytes > 25 * 1024 * 1024) {
            throw new AdapterError(
              "sms",
              adapter.id,
              "invalid_request",
              "That picture message contains more than 25 MB of media.",
            );
          }
          media.push(downloaded);
        }
        const { mediaUrls: _providerUrls, ...trusted } = event;
        hydrated.push({ ...trusted, media });
      }

      await getService("messaging.applySmsEvents").call(
        { events: hydrated },
        { kind: "system" },
      );

      // Twilio reads a 200 with an empty TwiML document as "nothing to say
      // back", which is what we mean: any auto-reply is C7.14's keyword rules,
      // decided in the service layer rather than improvised here.
      return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
        status: 200,
        headers: { "content-type": "text/xml; charset=utf-8" },
      });
    } catch (error) {
      if (error instanceof WebhookError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      if (error instanceof AdapterError) {
        // A bad signature is not a temporary problem: telling the carrier to
        // retry would mean replaying a forgery every few minutes.
        const status =
          error.code === "authentication" || error.code === "invalid_request" ? 400 : 503;
        return Response.json(
          { error: error.message },
          { status, headers: status === 503 ? { "retry-after": "30" } : undefined },
        );
      }
      if (error instanceof ServiceError) {
        // A validation failure is ours and will not fix itself; anything else
        // might, so the carrier is asked to come back rather than dropping a
        // customer's message on the floor.
        const status = error.code === "validation" ? 422 : 503;
        return Response.json(
          {
            error:
              status === 503
                ? "That callback could not be recorded yet; retry it."
                : error.message,
          },
          { status, headers: status === 503 ? { "retry-after": "30" } : undefined },
        );
      }
      console.error("sms webhook processing failed", error);
      return Response.json({ error: "That callback could not be processed." }, { status: 500 });
    }
  };
}
