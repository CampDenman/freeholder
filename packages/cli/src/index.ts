#!/usr/bin/env node
// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// `freeholder update` (MASTER.md §39.10, C10.21).
//
// A thin client, like `scripts/doctor.mjs` and for the same reason: the update
// logic lives in the instance because it has to touch that instance's
// database, its adapters and its deploy target. This establishes an
// authenticated caller and prints what the platform says.
//
// Usage:
//   freeholder update --check
//   freeholder update --preflight [--version 0.2.0]
//   freeholder update --apply [--version 0.2.0]
//   freeholder update --rollback
//   freeholder update --status --json
//
// Auth, same as doctor: a scoped `--api-key` (the right answer for cron), or
// `--email`/`--password` with `--totp-secret` when the owner is enrolled.
//
// **Exit codes, because this is meant to live in a crontab and a monitor:**
//
//   0  nothing to do, or the action succeeded
//   1  an update is available and was not applied — the "you are behind" code
//   2  a security update is outstanding, or an action failed
//   3  the instance could not be reached or would not authenticate
//
// 1 and 2 are separated deliberately. A monitor should be able to page on
// "security release outstanding" without also paging every time a feature
// release ships, and an operator who collapses those two into one alert learns
// to ignore both.
import { createHmac } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const EXIT = {
  ok: 0,
  behind: 1,
  security: 2,
  unreachable: 3,
} as const;

interface Options {
  url: string;
  apiKey?: string;
  email?: string;
  password?: string;
  totpSecret?: string;
  version?: string;
  json: boolean;
  quiet: boolean;
}

/**
 * Drop trailing slashes so `${url}/api/v1/...` never doubles up.
 *
 * A loop rather than `/\/+$/`: that pattern backtracks polynomially on a
 * string of many slashes followed by anything else, which CodeQL flags and
 * which is a silly thing to inherit from a one-character convenience.
 */
function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

export function parseArgs(argv: readonly string[]): {
  command: string;
  action: string;
  options: Options;
} {
  const value = (name: string, fallback?: string) => {
    const index = argv.indexOf(`--${name}`);
    const found = index >= 0 ? argv[index + 1] : undefined;
    return found && !found.startsWith("--") ? found : fallback;
  };
  const flag = (name: string) => argv.includes(`--${name}`);
  const action = ["check", "preflight", "apply", "rollback", "status"].find((name) =>
    flag(name),
  );
  return {
    command: argv.find((entry) => !entry.startsWith("--")) ?? "",
    action: action ?? "status",
    options: {
      url: stripTrailingSlashes(
        value("url", process.env.FREEHOLDER_URL ?? "http://localhost:3000") ?? "",
      ),
      apiKey: value("api-key", process.env.FREEHOLDER_API_KEY),
      email: value("email", process.env.FREEHOLDER_EMAIL),
      password: value("password", process.env.FREEHOLDER_PASSWORD),
      totpSecret: value("totp-secret", process.env.FREEHOLDER_TOTP_SECRET),
      version: value("version"),
      json: flag("json"),
      quiet: flag("quiet"),
    },
  };
}

function base32Bytes(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value.toUpperCase().replace(/=|\s|-/g, "")) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("The TOTP secret is not valid base32.");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

/** RFC 6238's six-digit, SHA-1, 30-second authenticator profile. */
export function totpCode(secret: string, at = Date.now()): string {
  const counter = BigInt(Math.floor(at / 30_000));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", base32Bytes(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

class Unreachable extends Error {}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

function absorbCookies(jar: Map<string, string>, response: Response): void {
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(";", 1)[0] ?? "";
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator);
    const cookieValue = pair.slice(separator + 1);
    if (cookieValue) jar.set(name, cookieValue);
    else jar.delete(name);
  }
}

async function ownerSession(options: Options): Promise<Map<string, string>> {
  const jar = new Map<string, string>();
  const signIn = await fetch(`${options.url}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: options.email, password: options.password }),
  }).catch(() => {
    throw new Unreachable(`Could not reach ${options.url}.`);
  });
  absorbCookies(jar, signIn);
  const result = (await signIn.json().catch(() => ({}))) as { twoFactorRequired?: boolean };
  if (!signIn.ok) throw new Unreachable(`Sign-in failed (${signIn.status}).`);
  if (result.twoFactorRequired) {
    if (!options.totpSecret) {
      throw new Unreachable(
        "This owner requires two-factor authentication. Pass --totp-secret, or use a scoped --api-key.",
      );
    }
    const verify = await fetch(`${options.url}/api/auth/login/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(jar) },
      body: JSON.stringify({ code: totpCode(options.totpSecret) }),
    });
    absorbCookies(jar, verify);
    if (!verify.ok) throw new Unreachable(`Two-factor sign-in failed (${verify.status}).`);
  }
  return jar;
}

type Caller = <T>(name: string, input: unknown) => Promise<T>;

async function connect(options: Options): Promise<Caller> {
  if (options.apiKey) {
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${options.apiKey}`,
    };
    return async <T>(name: string, input: unknown) => {
      const response = await fetch(`${options.url}/api/v1/${name}`, {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      }).catch(() => {
        throw new Unreachable(`Could not reach ${options.url}.`);
      });
      return unwrap<T>(response, name);
    };
  }
  if (!options.email || !options.password) {
    throw new Unreachable(
      "Pass a scoped --api-key, or --email and --password. In cron, use an API key.",
    );
  }
  const jar = await ownerSession(options);
  return async <T>(name: string, input: unknown) => {
    const response = await fetch(`${options.url}/api/v1/${name}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader(jar),
        "x-csrf-token": decodeURIComponent(jar.get("freeholder_csrf") ?? ""),
      },
      body: JSON.stringify(input),
    });
    absorbCookies(jar, response);
    return unwrap<T>(response, name);
  };
}

async function unwrap<T>(response: Response, name: string): Promise<T> {
  const text = await response.text();
  let parsed: { error?: { message?: string } } | T;
  try {
    parsed = JSON.parse(text) as T;
  } catch {
    throw new Unreachable(`${name} did not answer JSON (${response.status}).`);
  }
  if (!response.ok) {
    const message =
      (parsed as { error?: { message?: string } }).error?.message ?? `status ${response.status}`;
    throw new Error(`${name} failed: ${message}`);
  }
  return parsed as T;
}

interface Status {
  posture: "current" | "behind" | "behind-security" | "unknown";
  sentence: string;
  currentVersion: string;
  missing: { version: string }[];
  missingSecurity: { version: string }[];
  earliestReachableVersion: string | null;
}

/** The exit code a monitor reads. */
export function exitFor(posture: Status["posture"]): number {
  if (posture === "behind-security") return EXIT.security;
  if (posture === "behind") return EXIT.behind;
  // `unknown` is not a failure to page on — it is an instance that has not
  // checked yet, which a first cron run will resolve on its own.
  return EXIT.ok;
}

export async function run(argv: readonly string[], out = console): Promise<number> {
  const { command, action, options } = parseArgs(argv);
  if (command && command !== "update") {
    out.error(`freeholder: unknown command "${command}". The only command is "update".`);
    return EXIT.security;
  }
  let call: Caller;
  try {
    call = await connect(options);
  } catch (error) {
    out.error(error instanceof Error ? error.message : String(error));
    return EXIT.unreachable;
  }

  try {
    switch (action) {
      case "check":
        await call("platform.checkUpdates", {});
        break;
      case "preflight": {
        const report = await call<{ ok: boolean; steps: { id: string; verdict: string; detail: string }[] }>(
          "platform.preflightUpdate",
          options.version ? { targetVersion: options.version } : {},
        );
        if (options.json) out.log(JSON.stringify(report, null, 2));
        else
          for (const step of report.steps) {
            out.log(`${step.verdict === "ok" ? "  ok  " : " FAIL "} ${step.id}: ${step.detail}`);
          }
        return report.ok ? EXIT.ok : EXIT.security;
      }
      case "apply": {
        const result = await call<{ status: string; id: string }>(
          "platform.applyUpdate",
          options.version ? { toVersion: options.version } : {},
        );
        if (options.json) out.log(JSON.stringify(result, null, 2));
        else out.log(`Update run ${result.id}: ${result.status}`);
        // A rolled-back run is not a success. Cron must be able to tell.
        return result.status === "completed" ? EXIT.ok : EXIT.security;
      }
      case "rollback": {
        const result = await call<{ status: string; toVersion: string }>(
          "platform.rollbackUpdate",
          {},
        );
        if (options.json) out.log(JSON.stringify(result, null, 2));
        else out.log(`Rolled back to ${result.toVersion}: ${result.status}`);
        return result.status === "completed" ? EXIT.ok : EXIT.security;
      }
      default:
        break;
    }

    const status = await call<Status>("platform.updateStatus", {});
    if (options.json) {
      out.log(JSON.stringify(status, null, 2));
    } else if (!options.quiet) {
      out.log(`${status.currentVersion} — ${status.sentence}`);
      for (const release of status.missingSecurity) {
        out.log(`  security: ${release.version}`);
      }
      if (status.earliestReachableVersion) {
        out.log(`  rollback reaches back to ${status.earliestReachableVersion}`);
      }
    }
    return exitFor(status.posture);
  } catch (error) {
    if (error instanceof Unreachable) {
      out.error(error.message);
      return EXIT.unreachable;
    }
    out.error(error instanceof Error ? error.message : String(error));
    return EXIT.security;
  }
}

/**
 * Whether this file is the program, rather than a module a test imported.
 *
 * Resolved through `realpath` on both sides. Comparing `import.meta.url` to
 * `process.argv[1]` as text breaks on Windows drive-letter case, on symlinked
 * `node_modules/.bin` shims, and on any path needing percent-encoding — and
 * when it breaks, the CLI silently does nothing and exits 0, which is the
 * worst possible failure for something a crontab reads the exit code of.
 */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly() || process.env.FREEHOLDER_CLI_RUN === "1") {
  run(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = EXIT.unreachable;
    });
}
