// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Trusted release public keys (MASTER.md §39.3, C10.03). The instance verifies
// the update feed with these keys. Rotation keeps the previous key as
// `retiring` until every supported image ships the successor.
import releaseKeys from "./trusted-release-keys.json";

export type ReleaseKeyStatus = "active" | "retiring";

export interface TrustedReleaseKey {
  id: string;
  publicKey: string;
  status: ReleaseKeyStatus;
}

export const TRUSTED_RELEASE_KEYS: readonly TrustedReleaseKey[] = releaseKeys as TrustedReleaseKey[];

export function trustedReleaseKey(
  id: string,
  keys: readonly TrustedReleaseKey[] = TRUSTED_RELEASE_KEYS,
): TrustedReleaseKey | undefined {
  return keys.find((key) => key.id === id);
}

export function activeReleaseKeys(
  keys: readonly TrustedReleaseKey[] = TRUSTED_RELEASE_KEYS,
): TrustedReleaseKey[] {
  return keys.filter((key) => key.status === "active");
}
