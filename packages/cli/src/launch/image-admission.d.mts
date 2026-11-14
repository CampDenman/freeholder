// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
export const IMAGE: "ghcr.io/campdenman/freeholder";
export const REPOSITORY: "CampDenman/freeholder";
export const SIGNER_WORKFLOW: "https://github.com/CampDenman/freeholder/.github/workflows/ci.yml@refs/heads/main";
export function attestationArguments(pin: string): string[];
export function assertReleaseAttestation(payload: unknown, options: { pin: string; gitSha?: string | null }): string;
export const ORIGIN_RUNTIME_PROFILE_PATH: "deploy/media-storage-runtime-profile.json";
export const ORIGIN_RUNTIME_PROFILE_SOURCES: readonly string[];
export interface OriginRuntimeProfile {
  format: "freeholder/original-quota-runtime-profile/v1";
  protocols: { origin: string; initialization: string; firstWrite: string; journal: string; restore: string };
  sources: { path: string; sha256: string }[];
}
export function assertOriginRuntimeProfile(value: unknown): OriginRuntimeProfile;
