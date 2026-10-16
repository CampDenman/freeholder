// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The launch's local record: `state.json` (what was created, no secrets) and
// `freeholder.env` (the site's complete environment, secrets included), both
// 0600 in ~/.config/freeholder/<name>/. Written after every step, so a re-run
// resumes and `--destroy` knows exactly what to remove.
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LaunchState } from "./types.js";

export function siteDirectory(name: string, root = process.env.FREEHOLDER_CONFIG_HOME ?? join(homedir(), ".config", "freeholder")): string {
  return join(root, name);
}

async function writePrivate(path: string, content: string): Promise<void> {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

export async function readState(dir: string): Promise<LaunchState | null> {
  try {
    return JSON.parse(await readFile(join(dir, "state.json"), "utf8")) as LaunchState;
  } catch {
    return null;
  }
}

export async function writeState(dir: string, state: LaunchState): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writePrivate(join(dir, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
}

export function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) env[match[1]!] = match[2]!;
  }
  return env;
}

export async function readEnv(dir: string): Promise<Record<string, string>> {
  try {
    return parseEnv(await readFile(join(dir, "freeholder.env"), "utf8"));
  } catch {
    return {};
  }
}

/** The order the recipe's `.env.example` uses, then anything else. */
const ORDER = ["BOOTSTRAP_SECRET", "SESSION_SECRET", "CREDENTIAL_KEY", "APP_URL", "FREEHOLDER_STORAGE", "S3_BUCKET", "S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_REGION", "S3_ADDRESSING_STYLE", "BACKUP_BUCKET", "POSTGRES_PASSWORD", "FREEHOLDER_DOMAIN", "FREEHOLDER_PRIMARY_DOMAIN", "FREEHOLDER_IMAGE"];

export function renderEnv(env: Record<string, string>): string {
  const keys = [...ORDER.filter((k) => k in env), ...Object.keys(env).filter((k) => !ORDER.includes(k)).sort()];
  return `# Written by freeholder launch. Back this file up somewhere safe:\n# losing CREDENTIAL_KEY means re-authorising every connected account.\n${keys.map((k) => `${k}=${env[k]}`).join("\n")}\n`;
}

export async function writeEnv(dir: string, env: Record<string, string>): Promise<string> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "freeholder.env");
  await writePrivate(path, renderEnv(env));
  return path;
}
