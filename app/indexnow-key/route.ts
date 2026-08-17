// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// IndexNow key file (MASTER.md §5, BigDataSEO.com §3.4).
//
// Published as `/{key}.txt`. The rewrite lives in proxy.ts so the URL a
// search engine fetches is the one the protocol requires.
import { headers } from "next/headers";
import { PATH_HEADER } from "@/core/http/headers";
import { indexNowKey } from "@/core/seo/indexnow";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const key = indexNowKey();
  const requested = (await headers()).get(PATH_HEADER);
  if (requested && requested !== `/${key}.txt`) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(key, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}
