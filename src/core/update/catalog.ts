// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The update read model (MASTER.md §39.10, C10.11).
//
// §39.10 lists four entities and then says "Four surfaces, one service layer".
// The surfaces — admin (C10.20), CLI (C10.21), MCP and notifications (C10.22)
// — must not each compute "how far behind am I" from the raw feed, because
// four answers to that question is four chances to disagree about whether a
// business is exposed. They read this.
//
// Caching exists for the same reason: an owner asking "am I exposed?" must get
// an answer when the feed is unreachable, and "I could not reach the feed" is a
// different sentence from "you are up to date".
import { desc, sql } from "drizzle-orm";
import type { ReleaseChannel } from "./channels";
import { channelReceives } from "./channels";
import type { VerifiedRelease } from "./feed";
import { compareVersions, type MissingRelease } from "./fork";
import type { Severity } from "./release";
import { availableReleases } from "./schema";

export interface CachedRelease {
  version: string;
  channel: ReleaseChannel;
  digest: string;
  severity: Severity;
  cvss: number | null;
  schemaBreaking: boolean;
  minFromVersion: string;
  pluginApi: string;
  notesUrl: string;
  publishedAt: Date;
  verified: boolean;
}

type Tx = {
  insert: (table: typeof availableReleases) => {
    values: (rows: unknown[]) => {
      onConflictDoUpdate: (config: unknown) => Promise<unknown>;
    };
  };
  select: () => {
    from: (table: typeof availableReleases) => {
      orderBy: (...args: unknown[]) => Promise<Record<string, unknown>[]>;
    };
  };
};

/**
 * Write what a verified feed offered.
 *
 * Upsert by version, never insert-only: a release whose metadata is corrected
 * upstream must correct here too, and a cache that can only grow will happily
 * keep telling an owner about a CVSS score that was withdrawn.
 */
export async function cacheReleases(
  tx: Tx,
  releases: readonly VerifiedRelease[],
  verified = true,
): Promise<number> {
  if (releases.length === 0) return 0;
  const rows = releases.map((release) => ({
    version: release.version,
    channel: release.channel,
    digest: release.digest,
    severity: release.severity,
    // String, not a number: the driver wants text for `numeric`, and
    // `toFixed` is barred repo-wide because it rounds in floating point.
    cvss: release.cvss === null ? null : String(release.cvss),
    schemaBreaking: release.schemaRisk === "breaking",
    minFromVersion: release.minFromVersion,
    pluginApi: release.pluginApi,
    notesUrl: release.notesUrl,
    publishedAt: new Date(release.publishedAt),
    verified,
  }));
  await tx
    .insert(availableReleases)
    .values(rows)
    .onConflictDoUpdate({
      target: availableReleases.version,
      set: {
        channel: sql`excluded.channel`,
        digest: sql`excluded.digest`,
        severity: sql`excluded.severity`,
        cvss: sql`excluded.cvss`,
        schemaBreaking: sql`excluded.schema_breaking`,
        minFromVersion: sql`excluded.min_from_version`,
        pluginApi: sql`excluded.plugin_api`,
        notesUrl: sql`excluded.notes_url`,
        publishedAt: sql`excluded.published_at`,
        verified: sql`excluded.verified`,
        seenAt: sql`now()`,
      },
    });
  return rows.length;
}

export async function listCachedReleases(tx: Tx): Promise<CachedRelease[]> {
  const rows = await tx
    .select()
    .from(availableReleases)
    .orderBy(desc(availableReleases.publishedAt));
  return rows.map((row) => ({
    version: String(row.version),
    channel: row.channel as ReleaseChannel,
    digest: String(row.digest),
    severity: row.severity as Severity,
    // numeric comes back as a string from the driver, and `Number(null)` is 0,
    // which would turn "no score" into "CVSS 0.0" — a sentence that reads as
    // "harmless" about a release nobody has scored.
    cvss: row.cvss === null || row.cvss === undefined ? null : Number(row.cvss),
    schemaBreaking: Boolean(row.schemaBreaking),
    minFromVersion: String(row.minFromVersion),
    pluginApi: String(row.pluginApi),
    notesUrl: String(row.notesUrl),
    publishedAt: new Date(row.publishedAt as string | Date),
    verified: Boolean(row.verified),
  }));
}

export type UpdatePosture = "current" | "behind" | "behind-security" | "unknown";

export interface UpdateStatus {
  posture: UpdatePosture;
  /** The one line §39.10 says must never be ambiguous. */
  sentence: string;
  /** True when this should be shown in the danger colour. */
  urgent: boolean;
  currentVersion: string;
  channel: ReleaseChannel;
  missing: MissingRelease[];
  missingSecurity: MissingRelease[];
  worstCvss: number | null;
  /** Oldest version still reachable by rollback, per §39.11's horizon. */
  earliestReachableVersion: string | null;
  lastCheckedAt: Date | null;
}

/**
 * The status line, computed once for all four surfaces.
 *
 * `unknown` is a real posture and not a failure: an instance that has never
 * completed a check has not been told it is safe, and saying "Up to date"
 * because the cache is empty is the exact silence §39.10 refuses.
 */
export function updateStatus(input: {
  currentVersion: string;
  channel: ReleaseChannel;
  cached: readonly CachedRelease[];
  lastCheckedAt: Date | null;
  checksEnabled: boolean;
}): UpdateStatus {
  const offered = input.cached.filter(
    (release) =>
      channelReceives(input.channel, release.channel) &&
      (compareVersions(release.version, input.currentVersion) ?? 0) > 0,
  );
  const missing: MissingRelease[] = offered
    .map((release) => ({
      version: release.version,
      severity: release.severity,
      cvss: release.cvss,
      notesUrl: release.notesUrl,
      publishedAt: release.publishedAt.toISOString(),
    }))
    .sort((a, b) => compareVersions(a.version, b.version) ?? 0);
  const missingSecurity = missing.filter(
    (release) => release.severity !== "none" && release.cvss !== null,
  );
  const scored = missingSecurity
    .map((release) => release.cvss)
    .filter((value): value is number => value !== null);
  const worstCvss = scored.length > 0 ? Math.max(...scored) : null;

  // §39.11's rollback horizon: once a later release contracts the schema, the
  // releases before it are no longer reachable by an image swap. The earliest
  // reachable version is the one just after the newest breaking release the
  // instance has already passed.
  const passedBreaking = input.cached
    .filter(
      (release) =>
        release.schemaBreaking &&
        (compareVersions(release.version, input.currentVersion) ?? 1) <= 0,
    )
    .sort((a, b) => compareVersions(b.version, a.version) ?? 0);
  const earliestReachableVersion = passedBreaking[0]?.version ?? null;

  let posture: UpdatePosture;
  let sentence: string;
  if (input.lastCheckedAt === null && input.cached.length === 0) {
    posture = "unknown";
    sentence = input.checksEnabled
      ? "No update check has completed yet, so this instance does not know whether it is current."
      : "Update checks are off. This instance will not learn about security releases on its own.";
  } else if (missingSecurity.length > 0) {
    posture = "behind-security";
    const count = missingSecurity.length;
    sentence =
      `${count} security release${count === 1 ? "" : "s"} behind` +
      (worstCvss === null ? "" : ` — CVSS ${worstCvss}`);
  } else if (missing.length > 0) {
    posture = "behind";
    sentence = `Update available — ${missing.at(-1)!.version}`;
  } else {
    posture = "current";
    sentence = "Up to date";
  }

  return {
    posture,
    sentence,
    urgent: posture === "behind-security",
    currentVersion: input.currentVersion,
    channel: input.channel,
    missing,
    missingSecurity,
    worstCvss,
    earliestReachableVersion,
    lastCheckedAt: input.lastCheckedAt,
  };
}
