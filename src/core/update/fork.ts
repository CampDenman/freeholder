// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The fork lane (MASTER.md §39.7, C10.09). Some owners will fork, and they are
// not doing anything wrong: this is an Apache-2.0 project and §37 explicitly
// contemplates an instance that modifies itself. For them an update is a merge
// rather than an image swap.
//
// Two things make that safe, and both live here as pure functions so they can
// be proved without a network or a repository:
//
//   - **Owner code is never overwritten.** Every diverging path is classified
//     through the same customization seams the rest of the updater uses
//     (§39.1). A conflict inside a seam is the owner's file winning by
//     definition; the lane reports it and stops rather than resolving it.
//   - **Drift is stated in security terms, not commit counts.** "Fourteen
//     commits behind" tells an owner nothing about whether they are exposed.
//     "Two security releases behind — CVSS 8.1" does.
import { parseSemver } from "@freeholder/plugin-kit";
import { channelReceives, type ReleaseChannel } from "./channels";
import type { VerifiedRelease } from "./feed";
import { classifyPath, type PathClass } from "./seams";

/** Ordering only. Prerelease suffixes are refused upstream by the feed schema. */
export function compareVersions(a: string, b: string): number | null {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return null;
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

export interface ClassifiedPaths {
  core: string[];
  seam: string[];
  ignored: string[];
}

/**
 * Split paths by who owns them.
 *
 * `core` is replaceable and upstream may rewrite it. `seam` is the owner's and
 * upstream must not. The distinction is what turns a merge conflict from a
 * question into an answer.
 */
export function classifyDivergence(paths: readonly string[]): ClassifiedPaths {
  const buckets: ClassifiedPaths = { core: [], seam: [], ignored: [] };
  for (const path of new Set(paths)) {
    const bucket: PathClass = classifyPath(path);
    buckets[bucket].push(path);
  }
  buckets.core.sort();
  buckets.seam.sort();
  buckets.ignored.sort();
  return buckets;
}

export interface MissingRelease {
  version: string;
  severity: VerifiedRelease["severity"];
  cvss: number | null;
  notesUrl: string;
  publishedAt: string;
}

/**
 * Releases newer than this fork that its channel would have offered it.
 *
 * Channel filtering happens here rather than at display time: an instance on
 * the security channel is not "behind" because a feature release exists, and
 * telling it so is how an owner learns to ignore the number.
 */
export function missingReleases(input: {
  currentVersion: string;
  channel: ReleaseChannel;
  releases: readonly VerifiedRelease[];
}): MissingRelease[] {
  const missing: MissingRelease[] = [];
  for (const release of input.releases) {
    if (!channelReceives(input.channel, release.channel)) continue;
    const order = compareVersions(release.version, input.currentVersion);
    if (order === null || order <= 0) continue;
    missing.push({
      version: release.version,
      severity: release.severity,
      cvss: release.cvss,
      notesUrl: release.notesUrl,
      publishedAt: release.publishedAt,
    });
  }
  return missing.sort(
    (a, b) => compareVersions(a.version, b.version) ?? a.version.localeCompare(b.version),
  );
}

/** Missing releases that carry a scored vulnerability fix. */
export function missingSecurityReleases(
  releases: readonly MissingRelease[],
): MissingRelease[] {
  return releases.filter((release) => release.severity !== "none" && release.cvss !== null);
}

export interface ForkDrift {
  /** Commits the fork carries that upstream does not. Owner work. */
  ahead: number;
  /** Upstream commits the fork has not merged. Exposure. */
  behind: number;
  diverged: ClassifiedPaths;
  missing: MissingRelease[];
  missingSecurity: MissingRelease[];
  /** The worst CVSS the fork is missing, for a screen with room for one line. */
  worstCvss: number | null;
  status: "current" | "behind" | "behind-security";
  sentence: string;
}

/**
 * One sentence an owner can act on, in the same grammar §39.10 gives the
 * non-fork admin status line. Silence must not be indistinguishable from
 * safety, so "up to date" is only ever said when it is true of security too.
 */
export function summarizeDrift(input: {
  ahead: number;
  behind: number;
  divergedPaths: readonly string[];
  currentVersion: string;
  channel: ReleaseChannel;
  releases: readonly VerifiedRelease[];
}): ForkDrift {
  const diverged = classifyDivergence(input.divergedPaths);
  const missing = missingReleases({
    currentVersion: input.currentVersion,
    channel: input.channel,
    releases: input.releases,
  });
  const missingSecurity = missingSecurityReleases(missing);
  const scored = missingSecurity
    .map((release) => release.cvss)
    .filter((value): value is number => value !== null);
  const worstCvss = scored.length > 0 ? Math.max(...scored) : null;

  const status: ForkDrift["status"] =
    missingSecurity.length > 0 ? "behind-security" : missing.length > 0 ? "behind" : "current";

  const plural = (count: number, noun: string) =>
    `${count} ${noun}${count === 1 ? "" : "s"}`;

  let sentence: string;
  if (status === "behind-security") {
    sentence =
      `${plural(missingSecurity.length, "security release")} behind` +
      (worstCvss === null ? "" : ` — CVSS ${worstCvss}`);
  } else if (status === "behind") {
    sentence = `${plural(missing.length, "release")} behind`;
  } else {
    sentence = "Up to date with upstream";
  }
  if (input.ahead > 0) {
    sentence += `; this fork carries ${plural(input.ahead, "commit")} of its own`;
  }

  return {
    ahead: input.ahead,
    behind: input.behind,
    diverged,
    missing,
    missingSecurity,
    worstCvss,
    status,
    sentence,
  };
}

export interface MergeConflict {
  path: string;
  owner: PathClass;
}

export interface ForkMergePlan {
  merges: boolean;
  conflicts: MergeConflict[];
  /** Conflicts inside a seam. The owner's file wins; the lane will not resolve them. */
  ownerConflicts: MergeConflict[];
  refusal: string | null;
}

/**
 * Decide what a merge result means before anything is written anywhere.
 *
 * A clean merge is a pull request. A conflict in core is a pull request the
 * owner resolves. A conflict in a seam is neither: upstream has reached into
 * a file the customization contract says is the owner's, and resolving it
 * automatically is exactly the overwrite this item exists to prevent.
 */
export function planForkMerge(conflictPaths: readonly string[]): ForkMergePlan {
  const conflicts: MergeConflict[] = [...new Set(conflictPaths)]
    .sort()
    .map((path) => ({ path, owner: classifyPath(path) }));
  const ownerConflicts = conflicts.filter((conflict) => conflict.owner === "seam");
  if (ownerConflicts.length > 0) {
    return {
      merges: false,
      conflicts,
      ownerConflicts,
      refusal:
        `Upstream changed ${ownerConflicts.length === 1 ? "a file" : "files"} inside a customization seam: ` +
        `${ownerConflicts.map((conflict) => conflict.path).join(", ")}. ` +
        "The fork lane will not resolve those for you — your copy is the one that is meant to win.",
    };
  }
  if (conflicts.length > 0) {
    return {
      merges: false,
      conflicts,
      ownerConflicts: [],
      refusal:
        `${conflicts.length === 1 ? "One core file conflicts" : `${conflicts.length} core files conflict`} with upstream. ` +
        "Resolve them on the branch; the pull request is where that review belongs.",
    };
  }
  return { merges: true, conflicts: [], ownerConflicts: [], refusal: null };
}
