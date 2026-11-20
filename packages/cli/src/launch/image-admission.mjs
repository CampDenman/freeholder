// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Shared existing release provenance policy; no provider or process runs on import.
export const IMAGE = "ghcr.io/campdenman/freeholder";
export const REPOSITORY = "CampDenman/freeholder";
export const SIGNER_WORKFLOW =
  "https://github.com/CampDenman/freeholder/.github/workflows/ci.yml@refs/heads/main";
const PIN = /^ghcr\.io\/campdenman\/freeholder@sha256:[a-f0-9]{64}$/;

// Fixed reader contract only. The real source profile/OCI metadata producer
// stays UNPUBLISHED until every consuming initializer/fence/recovery path is
// complete, reviewed and qualified. Old quota-v1 labels do not satisfy it.
export const ORIGIN_RUNTIME_PROFILE_PATH = "deploy/media-storage-runtime-profile.json";
export const ORIGIN_RUNTIME_PROFILE_SOURCES = Object.freeze([
  "Dockerfile",
  "db/migrations/0082_verified_media_transfer.sql",
  "deploy/digitalocean-droplet/infra/compose.yml",
  "src/adapters/storage/index.ts",
  "src/adapters/storage/managed.ts",
  "src/core/db/index.ts",
  "src/core/env.ts",
  "src/core/media/original-namespace-fence.ts",
  "src/core/media/provider-callers.ts",
  "src/core/media/quota-initialization-inventory.ts",
  "src/core/media/quota-initialization-proof.ts",
  "src/core/media/quota-initialization-schema.ts",
  "src/core/media/quota-initialization-service.ts",
  "src/core/media/quota-namespace-origin.ts",
  "src/core/media/storage-quota.ts",
  "src/core/media/transfer-namespace-control.ts",
  "src/core/media/transfer-quota.ts",
  "src/core/media/transfer-requests.ts",
  "src/core/media/write-ledger.ts",
  "src/core/services.ts",
  "src/core/tables.ts",
]);
export function assertOriginRuntimeProfile(value) {
  const object = item => item !== null && typeof item === "object" && !Array.isArray(item);
  const exact = (item, keys) => object(item) && Object.keys(item).sort().join("\0") === [...keys].sort().join("\0");
  if (!exact(value, ["format", "protocols", "sources"]) || value.format !== "freeholder/original-quota-runtime-profile/v1"
    || !exact(value.protocols, ["origin", "initialization", "firstWrite", "journal", "restore"])
    || value.protocols.origin !== "freeholder.provider-namespace-origin/v1"
    || value.protocols.initialization !== "original-quota-namespace-initialization/v1"
    || value.protocols.firstWrite !== "original-namespace-before-first-write/v1"
    || value.protocols.journal !== "original-quota-origin-journal/v1"
    || value.protocols.restore !== "original-quota-origin-restore-fence/v1"
    || !Array.isArray(value.sources) || value.sources.length !== ORIGIN_RUNTIME_PROFILE_SOURCES.length
    || value.sources.some((source, index) => !exact(source, ["path", "sha256"]) || source.path !== ORIGIN_RUNTIME_PROFILE_SOURCES[index] || typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256))) {
    throw new Error("The image has no complete supported original storage runtime profile.");
  }
  return value;
}

export function attestationArguments(pin) {
  if (!PIN.test(pin)) throw new Error("refusing to verify a pin that is not an immutable image digest");
  return [
    "attestation",
    "verify",
    `oci://${pin}`,
    "--repo",
    REPOSITORY,
    "--cert-identity",
    SIGNER_WORKFLOW,
    "--cert-oidc-issuer",
    "https://token.actions.githubusercontent.com",
    "--format",
    "json",
  ];
}

export function assertReleaseAttestation(payload, { pin, gitSha }) {
  if (!Array.isArray(payload) || payload.length !== 1) {
    throw new Error("expected exactly one attestation for the published image");
  }
  const result = payload[0]?.verificationResult;
  const certificate = result?.signature?.certificate;
  const subject = result?.statement?.subject?.[0];
  const digest = subject?.digest?.sha256;
  if (subject?.name !== IMAGE || digest !== pin.slice(pin.indexOf("sha256:") + "sha256:".length)) {
    throw new Error("attestation subject is not the linux/amd64 image being pinned");
  }
  if (result?.statement?.predicateType !== "https://slsa.dev/provenance/v1") {
    throw new Error("attestation is not SLSA provenance");
  }
  if (certificate?.sourceRepositoryURI !== "https://github.com/CampDenman/freeholder") {
    throw new Error("attestation was not produced by this repository");
  }
  if (certificate?.sourceRepositoryRef !== "refs/heads/main") {
    throw new Error("attestation was not produced from refs/heads/main");
  }
  if (certificate?.githubWorkflowTrigger !== "push") {
    throw new Error("attestation was not produced by a push to main");
  }
  if (certificate?.buildSignerURI !== SIGNER_WORKFLOW) {
    throw new Error("attestation was not signed by the main CI workflow");
  }
  const source = certificate?.sourceRepositoryDigest;
  if (typeof source !== "string" || !/^[a-f0-9]{40}$/.test(source)) {
    throw new Error("attestation did not name the source commit");
  }
  if (gitSha != null && source !== gitSha && !source.startsWith(gitSha)) {
    throw new Error("attestation commit does not match the requested revision");
  }
  return source;
}

