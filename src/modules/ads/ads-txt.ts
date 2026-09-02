// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Generated ads.txt / app-ads.txt (MASTER.md §4.16, C9.20).
//
// Programmatic demand requires the file; a hand-edited one goes stale. The
// body is assembled from owner-managed rows so a line exists only because
// somebody put it there, which is what "accurate" means — generating from
// whatever creatives happen to be live would claim DIRECT for a network the
// owner had already stopped using.

export const TXT_RELATIONSHIPS = ["DIRECT", "RESELLER"] as const;
export type TxtRelationship = (typeof TXT_RELATIONSHIPS)[number];

export const TXT_SURFACES = ["web", "app", "both"] as const;
export type TxtSurface = (typeof TXT_SURFACES)[number];

export interface AdsTxtLine {
  domain: string;
  accountId: string;
  relationship: TxtRelationship;
  certificationAuthorityId: string | null;
  surface: TxtSurface;
}

const DOMAIN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/** An IAB advertising-system domain, lowercase, no scheme. */
export function adsTxtDomain(value: string): string | null {
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  if (!DOMAIN.test(host)) return null;
  return host;
}

export function coversSurface(entry: TxtSurface, wanted: "web" | "app"): boolean {
  return entry === "both" || entry === wanted;
}

/**
 * The file a crawler fetches.
 *
 * Comment-only when there are no rows, so the route still answers and does
 * not claim authorized sellers the owner never listed.
 */
export function renderAdsTxtFile(
  entries: AdsTxtLine[],
  ownerDomain: string | null,
): string {
  const lines: string[] = [];
  if (ownerDomain) lines.push(`OWNERDOMAIN=${ownerDomain}`);
  for (const entry of entries) {
    const fields = [entry.domain, entry.accountId, entry.relationship];
    if (entry.certificationAuthorityId) fields.push(entry.certificationAuthorityId);
    lines.push(fields.join(", "));
  }
  if (lines.length === 0) {
    return "# No authorized digital sellers are listed.\n";
  }
  return `${lines.join("\n")}\n`;
}
