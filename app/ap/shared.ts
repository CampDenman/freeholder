// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.18: shared response helpers for the ActivityPub routes.
import { ACTIVITY_JSON } from "@/modules/members/federation/core";

export function activity(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": `${ACTIVITY_JSON}; charset=utf-8`, "cache-control": "public, max-age=60", vary: "accept" },
  });
}

export const notFound = () => new Response(null, { status: 404 });

export const ANONYMOUS = { kind: "anonymous" } as const;
