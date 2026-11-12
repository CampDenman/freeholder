// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.34: the notice actually rendered, not today's newly enabled destination.
import { createHash } from "node:crypto";
import { z } from "zod";
import { paradiseSite } from "@/adapters/paradise/config";
import { paradiseUrl } from "@/adapters/paradise/http";
import { env } from "@/core/env";
import { decryptMailOutbox, encryptMailOutbox } from "@/core/mail/outbox-crypto";

export const LEAD_NOTICE_FIELD = "_fh_lead_notice";
const notice = z.object({ version: z.literal(1), slug: z.string(), origin: z.string(), provider: z.literal("paradise"), baseUrl: z.string(), credentialFingerprint: z.string().regex(/^[a-f0-9]{64}$/), words: z.string().min(10).max(4_000), issued: z.number() }).strict();
export type LeadNotice = z.infer<typeof notice>;
export function leadCredentialFingerprint(baseUrl: string, apiKey: string) {
  return createHash("sha256").update(JSON.stringify([baseUrl, apiKey])).digest("hex");
}
export function issueLeadNotice(slug: string, words: string): string | undefined {
  const current = env(), site = paradiseSite();
  if (current.LEAD_SINK_PROVIDER !== "paradise" || current.FREEHOLDER_PLAYGROUND === "1" || !site.apiKey || !current.SESSION_SECRET) return undefined;
  try { paradiseUrl(site.baseUrl, "/api/collect/lead"); } catch { return undefined; }
  const origin = new URL(current.APP_URL).origin;
  return encryptMailOutbox(JSON.stringify({ version: 1, slug, origin, provider: "paradise", baseUrl: site.baseUrl, credentialFingerprint: leadCredentialFingerprint(site.baseUrl, site.apiKey), words, issued: Date.now() }), `lead-notice:${origin}:${slug}`);
}
export function openLeadNotice(token: unknown, slug: string): LeadNotice | null {
  if (typeof token !== "string" || !env().SESSION_SECRET) return null;
  const origin = new URL(env().APP_URL).origin;
  try {
    const decoded = notice.parse(JSON.parse(decryptMailOutbox(token, `lead-notice:${origin}:${slug}`)) as unknown);
    if (decoded.origin !== origin || decoded.slug !== slug || Date.now() - decoded.issued > 86_400_000 || decoded.issued > Date.now() + 60_000) return null;
    return decoded;
  } catch { return null; }
}
