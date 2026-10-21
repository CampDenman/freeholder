// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Machine-readable release metadata (MASTER.md §39.2, C10.02). Compatibility,
// schema risk, CVSS and manual steps are declared; the updater never infers
// them from a version number.
import { z } from "zod";
import { RELEASE_VERSION, compareReleaseVersions } from "./release-version.mjs";
import { validateReleaseMetadata } from "./release-validation.mjs";
export { severityForCvss } from "./release-validation.mjs";
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
  .regex(RELEASE_VERSION, "must be a SemVer release version");

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

function refuse(message: string): never {
  throw new ReleaseMetadataError(message);
}

export function parseReleaseMetadata(input: unknown): ReleaseMetadata {
  try {
    return validateReleaseMetadata(input);
  } catch (error) {
    refuse(error instanceof Error ? error.message : String(error));
  }
}

export function canApplyFrom(
  fromVersion: string,
  release: ReleaseMetadata,
): { ok: boolean; reason: string } {
  if (!RELEASE_VERSION.test(fromVersion)) {
    return { ok: false, reason: `"${fromVersion}" is not semver, so this release cannot be applied from it.` };
  }
  const order = compareReleaseVersions(fromVersion, release.minFromVersion);
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
