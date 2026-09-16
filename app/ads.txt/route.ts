// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Generated ads.txt (MASTER.md §4.16, C9.20).
import { adsTxt } from "@/modules/ads/service";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;

export async function GET(): Promise<Response> {
  const { body } = await adsTxt.call({ surface: "web" }, ANONYMOUS);
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
