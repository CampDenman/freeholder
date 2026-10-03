// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

export const IMAGE: string;
export const REPOSITORY: string;
export const SIGNER_WORKFLOW: string;

export function parseRevision(input: string): { reference: string; gitSha: string | null };

export function selectLinuxAmd64Digest(manifest: {
  mediaType?: string;
  headerDigest?: string;
  body?: {
    mediaType?: string;
    manifests?: Array<{
      digest?: string;
      platform?: { os?: string; architecture?: string; variant?: string | null };
    }>;
  };
}): string;

export function resolvePublishedDigest(
  revision: string,
  fetchImpl?: typeof fetch,
): Promise<{ reference: string; gitSha: string | null; digest: string; pin: string }>;

export function attestationArguments(pin: string): string[];

export function assertReleaseAttestation(
  payload: unknown,
  options: { pin: string; gitSha: string | null },
): string;

export function assertHealthUrl(value: string): string;

export function deployTargetFromEnv(env?: Record<string, string | undefined>): {
  host: string;
  user: string;
  key: string;
  knownHosts: string;
  dir: string;
  healthUrl: string;
};

export function waitForHealth(
  url: string,
  options?: {
    attempts?: number;
    pauseMs?: number;
    fetchImpl?: (
      url: string,
      init?: { signal?: AbortSignal },
    ) => Promise<{ ok: boolean; status: number; json: () => Promise<{ ok?: boolean }> }>;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<void>;

export function remoteApplyScript(): string;
export function remoteApplyBootstrap(): string;
