// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.30 (MASTER.md §44.9): evidence of known abuse imagery, kept by core
// media because every upload passes through it.
//
// A match is recorded for the legal report whichever modules are on: the
// members module only adds the review queue, the uploader link and the
// suspension on top. Only an actual match is evidence. An image the matcher
// could not check (an outage, or one too large) is held too, but under its
// own engine tag, and stays an ordinary file the owner can rescan or delete.
import { db } from "@/core/db";
import { ABUSE_MATCH_ENGINE, setAbuseRecorder } from "@/adapters/abuse-scan";
import { abuseReports } from "./abuse-schema";

/**
 * Installed by boot, before any service runs, so every path that scans an
 * upload has it. Recorded on its own connection: the evidence must survive
 * even if the upload that carried it is rolled back.
 */
export function installAbuseRecorder(): void {
  setAbuseRecorder(async (record) => {
    await db().insert(abuseReports).values({
      provider: record.provider,
      matchId: record.matchId ?? null,
      matchSource: record.source ?? null,
      sha256: record.sha256,
      contentType: record.contentType,
      bytes: record.bytes,
    });
  });
}

/** True for a file held because it matched: it may not be trashed, purged or rescanned. */
export function underLegalHold(asset: { status: string; scanStatus: string; scanEngine: string | null }): boolean {
  return asset.status === "quarantined" && asset.scanStatus === "infected" && Boolean(asset.scanEngine?.startsWith(ABUSE_MATCH_ENGINE));
}
