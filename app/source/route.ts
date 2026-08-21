// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// `/source` — what this instance is running (MASTER.md §37, C4.22).
//
// §37 asks for the base version, the applied plugins, the licence and notices,
// and the diff the builder produced, at a stable path an owner can point a
// tool at.
//
// It is **not** public, and that is a deliberate reading of the licence rather
// than an oversight. Apache-2.0 does not require an operator to publish
// private modifications merely because they run them over a network, so this
// route owes the world nothing. What it owes the *owner* is the ability to say
// exactly what their instance became — and since the answer is a map of the
// instance's plugins and changes, handing it to an anonymous caller would be
// giving an attacker their first reconnaissance step for free.
import { actorFromRequest } from "@/core/http/actor";
import { getService, ServiceError } from "@/core/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const headers = {
    "content-type": "application/json; charset=utf-8",
    // A provenance answer is about this moment, and a cached one would say
    // what the instance used to be.
    "cache-control": "no-store, max-age=0",
    "x-robots-tag": "noindex, nofollow",
  };

  let actor: Awaited<ReturnType<typeof actorFromRequest>>;
  try {
    actor = await actorFromRequest(request);
  } catch {
    return new Response(JSON.stringify({ error: "unauthenticated" }), {
      status: 401,
      headers,
    });
  }

  try {
    const provenance = await getService("platform.source").call(
      {
        includeLicenceText: url.searchParams.get("license") === "full",
        changeLimit: 50,
      },
      actor,
    );
    return new Response(JSON.stringify(provenance, null, 2), { status: 200, headers });
  } catch (error) {
    if (error instanceof ServiceError && error.code === "permission") {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers,
      });
    }
    console.error("/source could not be assembled", error);
    return new Response(JSON.stringify({ error: "unavailable" }), {
      status: 500,
      headers,
    });
  }
}
