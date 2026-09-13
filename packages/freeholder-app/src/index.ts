#!/usr/bin/env node
// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// `freeholder-app init` (MASTER.md §35, C10.15).
//
// A client of the instance's public discovery document. No EAS login, no
// store credentials, no second copy of branding — those live on the instance
// and this command copies what a signed-out visitor can already see.
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT, InitError, initApp, printResult, type FetchLike } from "./init.js";

export { EXIT, InitError, initApp, pullBranding } from "./init.js";
export { parseHex, brandingFrom, storeCopy } from "./branding.js";
export { brandedExpoConfig, bundleId, diffJson, expoSlug, formatDiff, mergeEasConfig } from "./config.js";
export { ICON_SIZE, SCREENSHOT, SPLASH, generateAssets } from "./assets.js";
export { decodePng, encodePng, encodeRgba, pngSize } from "./png.js";

export interface Options {
  url: string;
  dir: string;
  json: boolean;
  help: boolean;
}

function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

function flagValue(argv: readonly string[], name: string, fallback?: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  const found = index >= 0 ? argv[index + 1] : undefined;
  return found && !found.startsWith("--") ? found : fallback;
}

export function defaultAppDir(cwd = process.cwd()): string {
  if (existsSync(join(cwd, "apps/mobile/app.json"))) return join(cwd, "apps/mobile");
  if (existsSync(join(cwd, "app.json"))) return cwd;
  return join(cwd, "apps/mobile");
}

export function parseArgs(argv: readonly string[], cwd = process.cwd()): {
  command: string;
  options: Options;
} {
  const walked: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const entry = argv[i]!;
    if (entry === "--url" || entry === "--dir") {
      i += 1;
      continue;
    }
    if (entry.startsWith("--")) continue;
    walked.push(entry);
  }
  const first = walked[0];
  const looksLikeUrl = Boolean(first && (first.includes(".") || first.includes("://") || first === "localhost"));
  const command = first === "help" ? "help" : first && first !== "init" && !looksLikeUrl ? first : "init";
  const positionalUrl = first === "init" ? walked[1] : looksLikeUrl ? first : undefined;
  return {
    command,
    options: {
      url: stripTrailingSlashes(
        flagValue(argv, "url", positionalUrl ?? process.env.FREEHOLDER_URL) ?? "",
      ),
      dir: flagValue(argv, "dir", defaultAppDir(cwd)) ?? defaultAppDir(cwd),
      json: argv.includes("--json"),
      help: argv.includes("--help") || argv.includes("-h"),
    },
  };
}

export function usage(): string {
  return `Usage: freeholder-app init <instance-url> [options]

Pull branding from a Freeholder instance and write store-ready app assets.
Does not require EAS credentials — producing store binaries is a later step.

Options:
  --url <url>     Instance URL (or pass it as the argument)
  --dir <path>    App directory (default: apps/mobile, or cwd if it is an Expo app)
  --json          Print the config diff as JSON
  --help          Show this help

Exit codes:
  0  assets and config written
  1  usage error
  2  the address is not a usable Freeholder instance
  3  the instance could not be reached`;
}

const defaultFetch: FetchLike = async (url) => {
  const response = await fetch(url);
  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    json: () => response.json(),
    arrayBuffer: () => response.arrayBuffer(),
  };
};

export async function run(
  argv: readonly string[],
  out: { log: (msg: string) => void; error: (msg: string) => void } = console,
  fetchImpl: FetchLike = defaultFetch,
  cwd = process.cwd(),
): Promise<number> {
  const { command, options } = parseArgs(argv, cwd);
  if (options.help || command === "help") {
    out.log(usage());
    return EXIT.ok;
  }
  if (command && command !== "init") {
    out.error(`freeholder-app: unknown command "${command}". The only command is "init".`);
    return EXIT.usage;
  }
  if (!options.url) {
    out.error(usage());
    return EXIT.usage;
  }
  try {
    const result = await initApp(options, fetchImpl);
    printResult(result, options.json, out);
    return EXIT.ok;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    out.error(message);
    return error instanceof InitError ? error.code : EXIT.unreachable;
  }
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly() || process.env.FREEHOLDER_APP_RUN === "1") {
  run(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = EXIT.unreachable;
    });
}
