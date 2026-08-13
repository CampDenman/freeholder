// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The HTTP API (MASTER.md §11, §28).
//
// One route, every service. §11 already made the service registry "the single
// choke point" that the admin UI, the API and MCP all reach through, and §28
// requires that the published contract cannot drift from what the code
// enforces. Those two together decide the shape of this file: the API is a
// *projection* of the registry rather than a layer written alongside it.
//
// So the surface is `<module>.<verb>` rather than REST resources — see the
// note in MASTER.md §28, updated in the same commit that added this. A REST
// layer would need a hand-written mapping from services to paths, verbs and
// path parameters, and that mapping is precisely the second source of truth
// §28 exists to prevent. Here there is nothing to keep in step: a service
// exists, therefore its endpoint exists, therefore its OpenAPI entry exists.
//
// What this deliberately does *not* do is bypass anything. It resolves a name
// and hands off to `serviceRoute`, so permissions, Zod validation, the
// transaction, rate limits, audit and CSRF are all the same code the admin
// screens go through. A route that reimplemented any of that would be exactly
// the "second door with different locks" §2 principle 7 warns about.
import { getService, ServiceError, type Service } from "@/core/service";
import { serviceRoute } from "@/core/http/route";
import { errorResponse } from "@/core/http/respond";
import { actorFromRequest } from "@/core/http/actor";
import { ready } from "@/core/runtime";

/** The prefix every dispatched call lives under. Versioned from day one. */
export const API_BASE = "/api/v1";

/**
 * Query-string values are strings; Zod schemas are not.
 *
 * `?includeHidden=true` has to reach a `z.boolean()` as a boolean or every GET
 * with a flag fails validation. The rule is deliberately narrow: a value is
 * parsed as JSON only when it *looks* like a non-string literal, so `?name=Ann`
 * stays the string "Ann" and only `true`, `42`, `null`, `[…]` and `{…}` are
 * converted.
 *
 * It is still a guess, and a genuinely ambiguous case — a string field whose
 * value is the word "true" — would guess wrong. That is what the POST body is
 * for: a query may also be called with `POST` and a JSON body, where types are
 * explicit and nothing has to be inferred.
 */
const LOOKS_STRUCTURED = /^(true|false|null|-?\d|\[|\{|")/;

export function coerceQuery(url: URL): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of url.searchParams) {
    if (!LOOKS_STRUCTURED.test(raw)) {
      out[key] = raw;
      continue;
    }
    try {
      out[key] = JSON.parse(raw);
    } catch {
      // "2 Fifth Street" starts with a digit and is not JSON. The literal
      // string was what the caller meant.
      out[key] = raw;
    }
  }
  return out;
}

function resolve(name: string): Service {
  // getService throws a not_found ServiceError, which the responder already
  // maps to 404 — an unknown service and an unknown URL should not answer
  // differently, because to a caller they are the same mistake.
  return getService(name);
}

/**
 * Handle one dispatched call.
 *
 * The method is enforced against the service's declared `kind`: a query is a
 * GET (or a POST carrying a JSON body), and a mutation is a POST only. That
 * asymmetry is not decoration — a mutation reachable by GET is one a browser
 * prefetch, a crawler or an `<img>` tag can trigger, and no amount of CSRF
 * defence downstream helps if the request never looked unsafe to begin with.
 */
export async function dispatch(
  request: Request,
  serviceName: string,
): Promise<Response> {
  // Before the lookup, not after. `defineService.call` awaits `ready()` for
  // itself, but this route reaches the registry *first* — and an unbooted
  // registry is an empty one, so without this every endpoint answers 404 on a
  // cold process and starts working once something else happens to boot it.
  // The same trap core/runtime.ts was written for, one layer up.
  await ready();

  let service: Service;
  try {
    service = resolve(serviceName);
  } catch (error) {
    return errorResponse(error, await actorFromRequest(request));
  }

  const method = request.method.toUpperCase();
  if (service.def.kind === "mutation" && method !== "POST") {
    return errorResponse(
      new ServiceError(
        "validation",
        `${serviceName} changes data, so it must be called with POST.`,
      ),
      await actorFromRequest(request),
    );
  }

  return serviceRoute(service, {
    readInput: async (req) => {
      if (req.method.toUpperCase() === "GET") {
        return coerceQuery(new URL(req.url));
      }
      const text = await req.text();
      if (!text) return {};
      try {
        // Typed as unknown rather than any: the service's Zod parse is what
        // decides what this is, and letting `any` past here would let an
        // unchecked shape flow into the call unnoticed.
        return JSON.parse(text) as unknown;
      } catch {
        // Left to the service's own Zod parse, so a malformed body reads the
        // same as a body with the wrong fields rather than as a special case.
        return {};
      }
    },
  })(request);
}
