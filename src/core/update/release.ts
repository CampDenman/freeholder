// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Machine-readable release metadata (MASTER.md §39.2, C10.02). Compatibility,
// schema risk, CVSS and manual steps are declared; the updater never infers
// them from a version number.
import { z } from "zod";
import { parseSemver } from "@freeholder/plugin-kit";
import {
  RELEASE_CHANNELS,
  type ReleaseChannel,
} from "./channels";

export const SEVERITIES = ["none", "low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SCHEMA_RISKS = ["compatible", "breaking"] as const;
export type SchemaRisk = (typeof SCHEMA_RISKS)[number];

export interface ManualStep {
  id: string;
  summary: string;
}

export interface ReleaseMetadata {
  version: string;
  channel: ReleaseChannel;
  minFromVersion: string;
  schemaRisk: SchemaRisk;
  cvss: number | null;
  severity: Severity;
  manualSteps: ManualStep[];
  pluginApi: string;
}

export class ReleaseMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseMetadataError";
  }
}

const semver = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, "must be semver X.Y.Z with no prerelease suffix");

export const releaseMetadataSchema = z.object({
  version: semver,
  channel: z.enum(RELEASE_CHANNELS),
  minFromVersion: semver,
  schemaRisk: z.enum(SCHEMA_RISKS),
  cvss: z.number().min(0).max(10).nullable(),
  severity: z.enum(SEVERITIES),
  manualSteps: z.array(
    z.object({
      id: z.string().min(1),
      summary: z.string().min(1),
    }),
  ),
  pluginApi: semver,
});

/** NVD 3.x bands. Used only to refuse a mismatch, never to fill a missing field. */
export function severityForCvss(cvss: number): Severity {
  if (cvss <= 0) return "none";
  if (cvss < 4) return "low";
  if (cvss < 7) return "medium";
  if (cvss < 9) return "high";
  return "critical";
}

function cmp(a: string, b: string): number | null {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return null;
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function refuse(message: string): never {
  throw new ReleaseMetadataError(message);
}

export function parseReleaseMetadata(input: unknown): ReleaseMetadata {
  const parsed = releaseMetadataSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path.length ? first.path.join(".") : "metadata";
    refuse(
      `${path} is missing or invalid. Compatibility, schema risk, CVSS and manual steps must be declared; the updater will not infer them from a version number.`,
    );
  }
  const release = parsed.data;
  const order = cmp(release.minFromVersion, release.version);
  if (order === null) {
    refuse("version and minFromVersion must be semver.");
  }
  if (order > 0) {
    refuse(
      `minFromVersion ${release.minFromVersion} is after version ${release.version}, so nothing could apply this release.`,
    );
  }
  if (release.cvss === null) {
    if (release.severity !== "none") {
      refuse("severity without a CVSS score is incomplete. Declare both, or neither.");
    }
  } else if (severityForCvss(release.cvss) !== release.severity) {
    refuse(
      `severity ${release.severity} does not match CVSS ${release.cvss}. Declare the NVD band that score actually falls in.`,
    );
  }
  if (release.channel === "security") {
    if (release.cvss === null || release.cvss <= 0) {
      refuse(
        "A security-channel release must include a CVSS score. The updater will not treat a patch version as a security fix.",
      );
    }
    if (release.schemaRisk === "breaking") {
      refuse(
        "A security-channel release cannot break schema. Security patches are backports of fixes, not a place for contract changes.",
      );
    }
  }
  return release;
}

export function canApplyFrom(
  fromVersion: string,
  release: ReleaseMetadata,
): { ok: boolean; reason: string } {
  if (!parseSemver(fromVersion) || !/^\d+\.\d+\.\d+$/.test(fromVersion)) {
    return { ok: false, reason: `"${fromVersion}" is not semver, so this release cannot be applied from it.` };
  }
  const order = cmp(fromVersion, release.minFromVersion);
  if (order === null) {
    return { ok: false, reason: `"${fromVersion}" is not semver, so this release cannot be applied from it.` };
  }
  if (order < 0) {
    return {
      ok: false,
      reason: `This release can be applied from ${release.minFromVersion}, not from ${fromVersion}.`,
    };
  }
  return {
    ok: true,
    reason: `This release can be applied from ${fromVersion}.`,
  };
}
