// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.26–C12.27: signed events from the site's payout provider.
import { readBoundedBytes, RequestBodyError } from "@/core/http/body";
import { AdapterError } from "@/adapters/types";
import { payoutProvider } from "@/adapters/payouts";
import { applyPayoutWebhook } from "@/modules/members/provider-payouts";

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
    events = await provider.webhook({ headers, body, receivedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof AdapterError) return new Response(null, { status: error.code === "authentication" ? 401 : error.code === "unavailable" ? 503 : 400 });
    throw error;
  }
  await applyPayoutWebhook.call({ provider: provider.id, events }, { kind: "system" });
  return new Response(null, { status: 200 });
}
