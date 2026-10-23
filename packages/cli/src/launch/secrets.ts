// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Secrets are generated here, written only to the 0600 env file, and never
// printed: every line the launch prints passes through a redactor that knows
// each one.
import { randomBytes } from "node:crypto";

export const GENERATED_SECRETS = ["BOOTSTRAP_SECRET", "SESSION_SECRET", "CREDENTIAL_KEY", "POSTGRES_PASSWORD"] as const;
/** Env values that must never appear in output. */
export const SECRET_KEYS = [...GENERATED_SECRETS, "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "PARADISEMODERN_API_KEY"] as const;

export const randomHex = (): string => randomBytes(32).toString("hex");

export function generateSecrets(): Record<(typeof GENERATED_SECRETS)[number], string> {
  return { BOOTSTRAP_SECRET: randomHex(), SESSION_SECRET: randomHex(), CREDENTIAL_KEY: randomHex(), POSTGRES_PASSWORD: randomHex() };
}

export class Redactor {
  private readonly secrets = new Set<string>();
  add(...values: (string | undefined)[]): void {
    for (const v of values) if (v && v.length >= 8) this.secrets.add(v);
  }
  addEnv(env: Record<string, string>): void {
    for (const key of SECRET_KEYS) this.add(env[key]);
  }
  clean(text: string): string {
    let out = text;
    for (const secret of this.secrets) out = out.split(secret).join("[redacted]");
    return out;
  }
}

/** The one place the bootstrap secret is shown: the owner's claim link. The fragment never reaches a server. */
export function claimLink(host: string, bootstrapSecret: string): string {
  return `https://${host}/setup#claim=${encodeURIComponent(bootstrapSecret)}`;
}
