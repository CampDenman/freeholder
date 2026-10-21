// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One metadata validator for the running image and its publication (C10.02).
import { RELEASE_VERSION, compareReleaseVersions } from "./release-version.mjs";

export function severityForCvss(cvss) {
  return cvss <= 0 ? "none" : cvss < 4 ? "low" : cvss < 7 ? "medium" : cvss < 9 ? "high" : "critical";
}

export function validateReleaseMetadata(input) {
  const invalid = (field) => { throw new Error(`${field} is missing or invalid. Compatibility, schema risk, CVSS and manual steps must be declared; the updater will not infer them from a version number.`); };
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid("metadata");
  for (const field of ["version", "minFromVersion", "pluginApi"]) {
    if (typeof input[field] !== "string" || !RELEASE_VERSION.test(input[field])) invalid(field);
  }
  if (!["stable", "security", "edge"].includes(input.channel)) invalid("channel");
  if (!["compatible", "breaking"].includes(input.schemaRisk)) invalid("schemaRisk");
  if (input.cvss !== null && (typeof input.cvss !== "number" || !Number.isFinite(input.cvss) || input.cvss < 0 || input.cvss > 10)) invalid("cvss");
  if (!["none", "low", "medium", "high", "critical"].includes(input.severity)) invalid("severity");
  if (!Array.isArray(input.manualSteps) || input.manualSteps.some((step) => !step || typeof step.id !== "string" || !step.id.trim() || typeof step.summary !== "string" || !step.summary.trim())) invalid("manualSteps");
  if (compareReleaseVersions(input.minFromVersion, input.version) > 0) throw new Error(`minFromVersion ${input.minFromVersion} is after version ${input.version}, so nothing could apply this release.`);
  if (input.version.includes("-") && input.channel !== "edge") throw new Error("A prerelease belongs to edge; stable and security releases require a final version.");
  if (input.cvss === null && input.severity !== "none") throw new Error("severity without a CVSS score is incomplete. Declare both, or neither.");
  if (input.cvss !== null && severityForCvss(input.cvss) !== input.severity) throw new Error(`severity ${input.severity} does not match CVSS ${input.cvss}. Declare the NVD band that score actually falls in.`);
  if (input.channel === "security" && (input.cvss === null || input.cvss <= 0)) throw new Error("A security-channel release must include a CVSS score. The updater will not treat a patch version as a security fix.");
  if (input.channel === "security" && input.schemaRisk === "breaking") throw new Error("A security-channel release cannot break schema. Security patches are backports of fixes, not a place for contract changes.");
  const { version, channel, minFromVersion, schemaRisk, cvss, severity, manualSteps, pluginApi } = input;
  return { version, channel, minFromVersion, schemaRisk, cvss, severity, manualSteps, pluginApi };
}
