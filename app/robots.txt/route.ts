// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// robots.txt (MASTER.md §5).
import { renderRobots } from "@/core/seo/sitemap";
import { originFor } from "@/core/seo/origin";
import { env } from "@/core/env";

export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  if (env().FREEHOLDER_PLAYGROUND === "1") return new Response("User-agent: *\nDisallow: /\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(renderRobots(originFor(request)), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
