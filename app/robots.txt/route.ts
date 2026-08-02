// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// robots.txt (MASTER.md §5).
import { renderRobots } from "@/core/seo/sitemap";
import { originFor } from "@/core/seo/origin";

export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  return new Response(renderRobots(originFor(request)), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
