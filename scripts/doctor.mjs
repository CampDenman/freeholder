// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Doctor, from a terminal (MASTER.md §17, §18).
//
// A thin client rather than a second implementation. The checks live in the
// application because they have to try the configured adapters. This client
// only establishes an authenticated caller and prints that canonical report.
//
// Usage:
//   node scripts/doctor.mjs --url http://localhost:3000 --email you@example.com --password ...
//   node scripts/doctor.mjs --totp-secret BASE32 --json
//   node scripts/doctor.mjs --api-key fh_... --json
//   FREEHOLDER_URL=... FREEHOLDER_API_KEY=... node scripts/doctor.mjs --json
//
// `--enroll-totp` is reserved for a fresh, disposable validation instance. It
// proves that the image's first owner can enroll before doctor runs, instead
// of weakening the privileged-account 2FA rule for CI.
//
// Exit codes, for cron and for CI: 0 clean, 1 warnings, 2 failures.
import { createHmac } from "node:crypto";
import { pathToFileURL } from "node:url";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function base32Bytes(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value.toUpperCase().replace(/=|\s|-/g, "")) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("The TOTP secret is not valid base32.");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

/** RFC 6238's six-digit, SHA-1, 30-second authenticator profile. */
export function totpCode(secret, at = Date.now()) {
  const counter = BigInt(Math.floor(at / 30_000));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", base32Bytes(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function absorbCookies(jar, response) {
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator);
    const cookieValue = pair.slice(separator + 1);
    if (cookieValue) jar.set(name, cookieValue);
    else jar.delete(name);
  }
}

function cookieHeader(jar) {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function body(response, label) {
  let parsed;
  try {
    parsed = await response.json();
  } catch {
    throw new Error(`${label} did not return JSON (${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}): ${parsed?.error?.message ?? "unknown error"}`);
  }
  return parsed;
}

async function service(url, name, input, jar) {
  const csrf = decodeURIComponent(jar.get("freeholder_csrf") ?? "");
  const response = await fetch(`${url}/api/v1/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader(jar),
      "x-csrf-token": csrf,
    },
    body: JSON.stringify(input),
  });
  absorbCookies(jar, response);
  return body(response, name);
}

async function ownerSession(url, email, password, totpSecret) {
  const jar = new Map();
  const signIn = await fetch(`${url}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  absorbCookies(jar, signIn);
  const result = await body(signIn, "Owner sign-in");

  if (result.twoFactorRequired) {
    if (!totpSecret) {
      throw new Error(
        "This owner requires two-factor authentication. Provide --totp-secret or FREEHOLDER_TOTP_SECRET, or use a scoped API key.",
      );
    }
    const verify = await fetch(`${url}/api/auth/login/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader(jar),
      },
      body: JSON.stringify({ code: totpCode(totpSecret) }),
    });
    absorbCookies(jar, verify);
    await body(verify, "Two-factor sign-in");
  }
  return jar;
}

async function enrollTotp(url, jar) {
  const enrollment = await service(url, "auth.beginTotpEnrollment", {}, jar);
  await service(
    url,
    "auth.confirmTotpEnrollment",
    {
      enrollmentToken: enrollment.enrollmentToken,
      code: totpCode(enrollment.secret),
    },
    jar,
  );
}

async function main() {
  const url = arg("url", process.env.FREEHOLDER_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const apiKey = arg("api-key", process.env.FREEHOLDER_API_KEY);
  const email = arg("email", process.env.FREEHOLDER_EMAIL);
  const password = arg("password", process.env.FREEHOLDER_PASSWORD);
  const totpSecret = arg("totp-secret", process.env.FREEHOLDER_TOTP_SECRET);
  const shouldEnroll = process.argv.includes("--enroll-totp");

  let headers;
  if (apiKey) {
    if (shouldEnroll) throw new Error("--enroll-totp requires a fresh owner session, not an API key.");
    headers = { authorization: `Bearer ${apiKey}` };
  } else {
    if (!email || !password) {
      throw new Error(
        "Doctor needs --email and --password (plus --totp-secret when enrolled), or a scoped --api-key.",
      );
    }
    const jar = await ownerSession(url, email, password, totpSecret);
    if (shouldEnroll) await enrollTotp(url, jar);
    headers = { cookie: cookieHeader(jar) };
  }

  const response = await fetch(`${url}/api/doctor`, { headers });
  const report = await response.json();
  if (!report.checks) throw new Error(`Doctor did not answer: ${response.status}`);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const mark = { ok: "  ok  ", warn: " warn ", fail: " FAIL " };
    for (const check of report.checks) {
      console.log(`${mark[check.verdict]} ${check.title}: ${check.detail}`);
      if (check.remedy) console.log(`         → ${check.remedy}`);
    }
    console.log("");
    console.log(
      report.verdict === "ok"
        ? "Everything doctor can check is working."
        : report.verdict === "warn"
          ? "Working, with things worth knowing about."
          : "Something is broken. The failures above will stop this instance doing its job.",
    );
  }
  return report.verdict === "fail" ? 2 : report.verdict === "warn" ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
