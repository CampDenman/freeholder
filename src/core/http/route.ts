// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Routes are thin wrappers over services (MASTER.md §10, §15.5) — and "thin"
// is only true if the wrapping is written once. serviceRoute is that once: it
// resolves the actor, reads the input, calls the service, and maps failures to
// status codes. A handler that needs more than `present` to shape its response
// is a sign the work belongs in a service.
//
// Framework-agnostic on purpose (web Request/Response, no next/* imports), so
// app/ stays a routing skin over an application that does not know about it.
import type { z } from "zod";
import { actorFromRequest } from "@/core/http/actor";
import { errorResponse, json } from "@/core/http/respond";
import type { Service } from "@/core/service";

export interface Presented {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface ServiceRouteOptions<Out> {
  /**
   * Where the input comes from. Defaults to the JSON body, or the query string
   * for GET. Routes whose input is a credential the browser holds — a session
   * token in a cookie — override this so the value is never accepted from a
   * caller-supplied body.
   */
  readInput?: (request: Request) => unknown;
  /**
   * Shape the success response. This is where a session token becomes a
   * Set-Cookie header instead of a field in the body.
   */
  present?: (result: Out) => Presented;
}

async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    // A malformed body is the caller's mistake, and the service's Zod parse
    // will say so in the same shape as every other bad request.
    return {};
  }
}

function readQuery(request: Request): unknown {
  return Object.fromEntries(new URL(request.url).searchParams);
}

export function serviceRoute<In extends z.ZodType, Out>(
  service: Service<In, Out>,
  options: ServiceRouteOptions<Out> = {},
): (request: Request) => Promise<Response> {
  return async function handler(request: Request): Promise<Response> {
    // Resolved before anything else, because it decides both what the service
    // will allow and whether a refusal reads as 401 or 403.
    const actor = await actorFromRequest(request);
    try {
      const input = options.readInput
        ? await options.readInput(request)
        : request.method === "GET"
          ? readQuery(request)
          : await readJsonBody(request);

      const result = await service.call(input, actor);
      const presented = options.present?.(result) ?? { body: result };
      return json(
        presented.body ?? { ok: true },
        presented.status ?? 200,
        presented.headers ?? {},
      );
    } catch (error) {
      return errorResponse(error, actor);
    }
  };
}
