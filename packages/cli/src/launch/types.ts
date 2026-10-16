// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// `freeholder launch` (MASTER.md C3.30): the provider seam. DigitalOcean is
// the first provider; Railway, Render and others implement the same shape.

export interface LaunchOptions {
  provider: string;
  domain: string;
  name: string;
  region: string;
  size: string;
  sshKey?: string;
  sshIdentity?: string;
  temporaryHost: boolean;
  image?: string;
  paradisemodernKey?: string;
  paradisemodernSiteId?: string;
  nonInteractive: boolean;
  json: boolean;
  dryRun: boolean;
  open: boolean;
  cutover: boolean;
  destroy: boolean;
  confirm?: string;
  context?: string;
}

/** Every step a launch records, in order, so a re-run continues where it stopped. */
export const STEPS = ["preflight", "image", "secrets", "spaces", "droplet", "cloud-init", "host", "deploy", "readiness", "backups"] as const;
export type Step = (typeof STEPS)[number];

/** What the launch created and decided. Never holds a secret. */
export interface LaunchState {
  version: 1;
  name: string;
  provider: string;
  domain: string;
  region: string;
  size: string;
  done: Step[];
  image?: string;
  buckets?: { media: string; backups: string };
  /** The permanent, bucket-scoped Spaces key (its id only; the secret is in the env file). */
  spacesKeyId?: string;
  /** A short-lived key whose deletion failed; deleted first on the next run. */
  orphanTemporaryKeyId?: string;
  dropletId?: number;
  ip?: string;
  sshKeyId?: number;
  host?: string;
  temporaryHost?: boolean;
}

/** A cloud's side of a launch. Each method is idempotent against `state`. */
export interface LaunchProvider {
  id: string;
  preflight(options: LaunchOptions, state: LaunchState | null): Promise<{ sshKeyId: number; notes: string[] }>;
  storage(options: LaunchOptions, state: LaunchState, save: (patch: Partial<LaunchState>, env?: Record<string, string>) => Promise<void>): Promise<void>;
  server(options: LaunchOptions, state: LaunchState, userData: string, save: (patch: Partial<LaunchState>) => Promise<void>): Promise<{ id: number; ip: string }>;
  destroy(state: LaunchState, log: (line: string) => void): Promise<void>;
  /** The object-storage endpoint and region the env file names. */
  storageEndpoint(region: string): { endpoint: string; region: string };
}

/** The new machine, reached over SSH. */
export interface Remote {
  run(command: string): Promise<{ code: number; stdout: string; stderr: string }>;
  /** Upload files into a directory, and write `.env`-style content with a mode. */
  upload(files: { local: string; remote: string }[]): Promise<void>;
  writeFile(remotePath: string, content: string, mode: string): Promise<void>;
}

export class LaunchFailure extends Error {
  constructor(
    message: string,
    /** What to do about it, in plain English. */
    readonly recovery: string,
    readonly code: number,
  ) {
    super(message);
  }
}
