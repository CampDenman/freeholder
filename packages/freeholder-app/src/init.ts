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
  url?: string;
  headers: { get(name: string): string | null };
  json: () => Promise<unknown>;
  arrayBuffer: () => Promise<ArrayBufferLike>;
}>;

/** Logos are marks, not galleries. A 1 MiB cap is well above any PNG icon. */
export const MAX_LOGO_BYTES = 1_048_576;

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

export function logoFetchUrl(raw: string, instanceOrigin: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(raw, `${instanceOrigin}/`);
  } catch {
    return null;
  }
  if (parsed.protocol === "http:" && !isLoopback(parsed.hostname)) return null;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.origin !== instanceOrigin) return null;
  return parsed;
}

async function readLogo(
  raw: string,
  instanceOrigin: string,
  fetchImpl: FetchLike,
): Promise<{ bytes: Uint8Array | null; note: string | null }> {
  const allowed = logoFetchUrl(raw, instanceOrigin);
  if (!allowed) {
    return { bytes: null, note: "Logo URL is not on the instance origin; icons use the brand colours." };
  }
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(allowed.toString());
  } catch {
    return { bytes: null, note: "The logo URL in discovery could not be fetched; icons use the brand colours." };
  }
  if (response.url) {
    const landed = logoFetchUrl(response.url, instanceOrigin);
    if (!landed) {
      return { bytes: null, note: "Logo URL redirected off the instance origin; icons use the brand colours." };
    }
  }
  if (!response.ok) {
    return { bytes: null, note: "The logo URL in discovery could not be fetched; icons use the brand colours." };
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_LOGO_BYTES) {
    return { bytes: null, note: "Logo is larger than 1 MiB; icons use the brand colours." };
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_LOGO_BYTES) {
    return { bytes: null, note: "Logo is larger than 1 MiB; icons use the brand colours." };
  }
  return { bytes, note: null };
}

export async function pullBranding(
  url: string,
  fetchImpl: FetchLike,
): Promise<{ brand: Branding; logo: Uint8Array | null; notes: string[] }> {
  const origin = normalizeUrl(url);
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(`${origin}/.well-known/freeholder`);
  } catch {
    throw new InitError(`Could not reach ${origin}.`, EXIT.unreachable);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new InitError("That address does not look like a Freeholder site.", EXIT.refused);
  }
  const document = payload as Record<string, unknown>;
  if (document?.freeholder !== true) {
    throw new InitError("That address does not look like a Freeholder site.", EXIT.refused);
  }
  if (response.status === 503 || document.setupComplete === false) {
    throw new InitError("This site is not finished being set up yet. Finish setup, then re-run init.", EXIT.refused);
  }
  if (typeof document.contractVersion !== "number") {
    throw new InitError("That address does not look like a Freeholder site.", EXIT.refused);
  }
  const brand = brandingFrom(origin, document);
  const notes: string[] = [];
  let logo: Uint8Array | null = null;
  if (brand.logoUrl) {
    const fetched = await readLogo(brand.logoUrl, origin, fetchImpl);
    logo = fetched.bytes;
    if (fetched.note) notes.push(fetched.note);
  }
  return { brand, logo, notes };
}

export async function initApp(options: InitOptions, fetchImpl: FetchLike): Promise<InitResult> {
  const { brand, logo, notes } = await pullBranding(options.url, fetchImpl);
  const generated = generateAssets(brand, logo);
  generated.notes.push(...notes);

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


