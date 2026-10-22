// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The document a pasted third-party tag runs in (MASTER.md §4.16, C11.10).
//
// Served from this site but sandboxed by its own CSP, so its origin is opaque
// whether it is framed by an ad slot or opened directly: the tag gets no
// cookies, storage or DOM of this site. Consent is checked here as well as in
// the slot, so the address alone never runs a tag for a visitor who declined.
import { cookies } from "next/headers";
import { env } from "@/core/env";
import {
  parseCspOrigins,
  thirdPartyCreativeConsentGranted,
  THIRD_PARTY_CREATIVE_CONSENT_COOKIE,
} from "@/core/http/csp";
import { creativeTag } from "@/modules/ads/service";
import { creativeDocument, creativeDocumentPolicy } from "@/modules/ads/tags";

export const dynamic = "force-dynamic";

const HEADERS = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const empty = new Response(null, {
    status: 404,
    headers: { ...HEADERS, "content-security-policy": "default-src 'none'; sandbox" },
  });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return empty;
  const consent = (await cookies()).get(THIRD_PARTY_CREATIVE_CONSENT_COOKIE)?.value;
  if (!thirdPartyCreativeConsentGranted(consent)) return empty;
  const found = await creativeTag.call({ id }, { kind: "system" });
  if (!found) return empty;
  return new Response(creativeDocument(found.html), {
    headers: {
      ...HEADERS,
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": creativeDocumentPolicy(
        parseCspOrigins(env().CSP_THIRD_PARTY_ORIGINS),
      ),
    },
  });
}
