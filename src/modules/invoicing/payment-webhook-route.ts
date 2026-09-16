// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Raw-body payment webhook boundary. Verification precedes every database effect.

import { createHash } from "node:crypto";
import { paymentAdapter } from "@/adapters/payments";
import type { HostedPaymentProviderId } from "@/adapters/payments/providers";
import { AdapterError } from "@/adapters/types";
import { ServiceError } from "@/core/service";
import { processPaymentProviderEvents } from "./payment-provider-service";
import { readBoundedBytes, RequestBodyError } from "@/core/http/body";

const MAX_WEBHOOK_BYTES = 1_048_576;

async function rawRequest(request: Request) {
  return readBoundedBytes(request, MAX_WEBHOOK_BYTES);
}

export function paymentWebhookRoute(provider: HostedPaymentProviderId) {
  return async (request: Request): Promise<Response> => {
    const receivedAt = new Date().toISOString();
    try {
      const body = await rawRequest(request);
      const headers = Object.fromEntries([...request.headers.entries()].map(([key, value]) => [key.toLowerCase(), value]));
      const events = await paymentAdapter(provider).verifyWebhook({ headers, body, receivedAt });
      const result = await processPaymentProviderEvents.call(
        {
          provider,
          bodySha256: createHash("sha256").update(body).digest("hex"),
          receivedAt,
          events,
        },
        { kind: "system" },
      );
      return Response.json({ ok: true, received: events.length, ...result });
    } catch (error) {
      if (error instanceof RequestBodyError) return Response.json({ error: error.message }, { status: error.status });
      if (error instanceof AdapterError) {
        const status = error.code === "authentication" || error.code === "invalid_request" ? 400 : 503;
        return Response.json({ error: error.message }, { status, headers: status === 503 ? { "retry-after": "30" } : undefined });
      }
      if (error instanceof ServiceError) {
        const status = error.code === "validation" ? 422 : 503;
        return Response.json(
          { error: status === 503 ? "Authenticated payment feedback could not be matched yet; retry it." : error.message },
          { status, headers: status === 503 ? { "retry-after": "30" } : undefined },
        );
      }
      console.error("payment webhook processing failed", error);
      return Response.json({ error: "Payment feedback could not be processed." }, { status: 500 });
    }
  };
}
