// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// This instance's live contract (MASTER.md §28.4).
//
// "An agent or developer never reasons from generic docs about what *this*
// instance can do — they ask it." So this is served from the running registry,
// reflecting the modules and plugins actually enabled here, rather than from a
// file generated at build time.
//
// Public, deliberately. It names services and describes their inputs, which is
// a map of the surface — but every one of them refuses an unauthorized caller
// on its own, and hiding the names would be obscurity standing in for the
// permission checks that are already doing the work. §28's whole design is
// that an agent can discover an instance; a contract behind a credential the
// agent needs the contract to obtain is a circle.
import { buildOpenApi } from "@/core/api/openapi";
import { siteOrigin } from "@/core/seo/origin";
import { currentBusiness } from "@/core/settings/read";
import { ready } from "@/core/runtime";
import { version } from "@/../package.json";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  // The registry is only complete once the platform has booted, and a route
  // can be the first thing a process serves (core/runtime.ts).
  await ready();
  const business = await currentBusiness();

  return Response.json(
    buildOpenApi({
      origin: siteOrigin(),
      version,
      title: business?.name ?? "Freeholder",
    }),
    { headers: { "cache-control": "no-store" } },
  );
}
