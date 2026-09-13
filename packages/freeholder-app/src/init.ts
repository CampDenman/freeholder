// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// `freeholder-app init` (MASTER.md §35, C10.15).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { generateAssets } from "./assets.js";
import { brandingFrom, type Branding } from "./branding.js";
import {
  brandedExpoConfig,
  diffJson,
  formatDiff,
  mergeEasConfig,
  type DiffEntry,
  type Json,
} from "./config.js";

export const EXIT = {
  ok: 0,
  usage: 1,
  refused: 2,
  unreachable: 3,
} as const;

export class InitError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json: () => Promise<unknown>;
  arrayBuffer: () => Promise<ArrayBufferLike>;
}>;

export interface InitOptions {
  url: string;
  dir: string;
  json: boolean;
}

export interface InitResult {
  instance: { url: string; name: string; tagline: string | null };
  filesWritten: string[];
  notes: string[];
  diff: { file: string; created: boolean; entries: DiffEntry[] }[];
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new InitError("Pass an instance URL, for example https://example.com.", EXIT.usage);
  let parsed: URL;
  try {
    parsed = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new InitError(`"${trimmed}" is not a web address.`, EXIT.usage);
  }
  if (parsed.protocol === "http:" && !isLoopback(parsed.hostname)) {
    throw new InitError(
      "That address is not secure (https). Pass the business's https URL.",
      EXIT.usage,
    );
  }
  return `${parsed.protocol}//${parsed.host}`;
}

async function readJson(path: string): Promise<Json | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Json;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function pullBranding(url: string, fetchImpl: FetchLike): Promise<{ brand: Branding; logo: Uint8Array | null }> {
  const origin = normalizeUrl(url);
  let payload: unknown;
  let status: number;
  try {
    const response = await fetchImpl(`${origin}/.well-known/freeholder`);
    status = response.status;
    payload = await response.json();
  } catch {
    throw new InitError(`Could not reach ${origin}.`, EXIT.unreachable);
  }
  const document = payload as Record<string, unknown>;
  if (document?.freeholder !== true) {
    throw new InitError("That address does not look like a Freeholder site.", EXIT.refused);
  }
  if (status === 503 || document.setupComplete === false) {
    throw new InitError("This site is not finished being set up yet. Finish setup, then re-run init.", EXIT.refused);
  }
  if (typeof document.contractVersion !== "number") {
    throw new InitError("That address does not look like a Freeholder site.", EXIT.refused);
  }
  const brand = brandingFrom(origin, document);
  let logo: Uint8Array | null = null;
  if (brand.logoUrl) {
    try {
      const response = await fetchImpl(brand.logoUrl);
      if (response.ok) logo = new Uint8Array(await response.arrayBuffer());
    } catch {
      logo = null;
    }
  }
  return { brand, logo };
}

export async function initApp(options: InitOptions, fetchImpl: FetchLike): Promise<InitResult> {
  const { brand, logo } = await pullBranding(options.url, fetchImpl);
  const generated = generateAssets(brand, logo);
  if (brand.logoUrl && !logo) {
    generated.notes.push("The logo URL in discovery could not be fetched; icons use the brand colours.");
  }

  const appPath = join(options.dir, "app.json");
  const easPath = join(options.dir, "eas.json");
  const beforeApp = await readJson(appPath);
  const beforeEas = await readJson(easPath);
  const afterApp = brandedExpoConfig(beforeApp ?? {}, brand);
  const afterEas = mergeEasConfig(beforeEas);

  const filesWritten: string[] = [];
  async function write(relative: string, contents: Buffer | string): Promise<void> {
    const path = join(options.dir, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
    filesWritten.push(relative);
  }

  for (const [relative, contents] of Object.entries(generated.files)) {
    await write(relative, contents);
  }
  await write("app.json", `${JSON.stringify(afterApp, null, 2)}\n`);
  await write("eas.json", `${JSON.stringify(afterEas, null, 2)}\n`);

  const diff = [
    { file: "app.json", created: beforeApp === null, entries: diffJson(beforeApp ?? {}, afterApp) },
    { file: "eas.json", created: beforeEas === null, entries: diffJson(beforeEas ?? {}, afterEas) },
  ];

  return {
    instance: { url: brand.url, name: brand.name, tagline: brand.tagline },
    filesWritten,
    notes: generated.notes,
    diff,
  };
}

export function printResult(result: InitResult, asJson: boolean, out: { log: (msg: string) => void }): void {
  if (asJson) {
    out.log(JSON.stringify(result, null, 2));
    return;
  }
  out.log(`Branded ${result.instance.name} from ${result.instance.url}.`);
  for (const note of result.notes) out.log(note);
  out.log("");
  out.log(formatDiff(result.diff));
  out.log("");
  out.log("Wrote:");
  for (const file of result.filesWritten) out.log(`  ${file}`);
  out.log("");
  out.log("EAS credentials are not required for init. Store binaries are a later build step.");
}


