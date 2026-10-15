// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.18: a federating member's inbox. Every activity must carry an HTTP
// signature from a key its own actor publishes; the actor is fetched through
// the pinned transport, outside any transaction, before anything is applied.
import { readBoundedText, RequestBodyError } from "@/core/http/body";
import { ServiceError } from "@/core/service";
import { federationDocument, federationInbox, fetchRemoteActor } from "@/modules/members/federation/core";
import { verifyRequest } from "@/modules/members/federation/signatures";
import { ANONYMOUS } from "../../../shared";

export const dynamic = "force-dynamic";
const MAX_BODY = 256 * 1024;

export async function POST(request: Request, { params }: { params: Promise<{ handle: string }> }): Promise<Response> {
  const { handle } = await params;
  if (!(await federationDocument.call({ kind: "webfinger", handle }, ANONYMOUS))) return new Response(null, { status: 404 });
  let body: string;
  try {
    body = await readBoundedText(request, MAX_BODY);
  } catch (error) {
    if (error instanceof RequestBodyError) return new Response(null, { status: error.status });
    throw error;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return new Response(null, { status: 400 });
  }
  const url = new URL(request.url);
  const headers = Object.fromEntries([...request.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]));
  let sender: Awaited<ReturnType<typeof fetchRemoteActor>> = null;
  try {
    await verifyRequest({
      method: "POST",
      path: `${url.pathname}${url.search}`,
      headers,
      body,
      publicKeyFor: async (keyId) => {
        sender = await fetchRemoteActor(keyId);
        return sender?.publicKeyPem ?? null;
      },
    });
  } catch {
    return new Response(null, { status: 401 });
  }
  const actorUri = typeof parsed.actor === "string" ? parsed.actor : (parsed.actor as { id?: string } | undefined)?.id;
  // The signer must be the actor the activity claims to come from.
  const verified = sender as Awaited<ReturnType<typeof fetchRemoteActor>>;
  if (!verified || actorUri !== verified.id) return new Response(null, { status: 401 });
  try {
    await federationInbox.call({ handle, activity: parsed, actor: { id: verified.id, inbox: verified.inbox, preferredUsername: verified.preferredUsername, endpoints: verified.endpoints } }, { kind: "system" });
  } catch (error) {
    if (error instanceof ServiceError) return new Response(null, { status: error.code === "not_found" ? 404 : 400 });
    throw error;
  }
  return new Response(null, { status: 202 });
}
