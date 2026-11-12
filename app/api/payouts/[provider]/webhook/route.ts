// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.26–C12.27: signed events from the site's payout provider.
import { readBoundedBytes, RequestBodyError } from "@/core/http/body";
import { AdapterError } from "@/adapters/types";
import { payoutProvider } from "@/adapters/payouts";
import { retainPaymentProviderEvidence } from "@/modules/invoicing/payment-provider-service";
import { applyPayoutWebhook } from "@/modules/members/provider-payouts";
import { resolveSubscriptionProviderScope, type SubscriptionProviderScopeInput } from "@/modules/invoicing/merchant-provider-stage";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }): Promise<Response> {
  const { provider: id } = await params;
  const provider = payoutProvider(id);
  if (!provider) return new Response(null, { status: 404 });
  let body: Uint8Array;
  try {
    body = await readBoundedBytes(request, 512 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyError) return new Response(null, { status: error.status });
    throw error;
  }
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
  let events;
  try {
    const verificationRequest = { headers, body, receivedAt: new Date().toISOString(), resolveSubscriptionScope: (input: SubscriptionProviderScopeInput) => resolveSubscriptionProviderScope(id === "stripe_connect" ? "stripe" : id, input) };
    events = await provider.webhook(verificationRequest);
  } catch (error) {
    if (error instanceof AdapterError) return new Response(null, { status: error.code === "authentication" ? 401 : error.code === "unavailable" || error.code === "provider_failure" || error.retryable ? 503 : 400 });
    throw error;
  }
  // Events for transfers that are not this site's (a shared provider
  // account) are acknowledged and ignored, so the provider keeps the endpoint.
  const financial = await retainPaymentProviderEvidence("stripe", events.flatMap(event => event.kind === "payment" ? [event.event] : []));
  let financialIndex = 0;
  events = events.map(event => event.kind === "payment" ? { ...event, event: financial[financialIndex++]! } : event);
  await applyPayoutWebhook.call({ provider: provider.id, events }, { kind: "system" });
  return new Response(null, { status: 200 });
}
