// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Small, auditable primitives for TOTP and recovery credentials. WebAuthn's
// considerably larger protocol is delegated to SimpleWebAuthn.
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "@/core/env";
import type { ModuleGrant } from "@/core/service";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PRIVILEGED_MODULES = new Set([
  "apikeys",
  "connections",
  "invitations",
  "roles",
]);

function secret(): string {
  const value = env().SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is required for two-factor authentication.");
  return value;
}

function keyed(domain: string, value: string): Buffer {
  return createHmac("sha256", secret()).update(`${domain}\0${value}`).digest();
}

export function hashTwoFactorToken(token: string): string {
  return keyed("freeholder:2fa-token:v1", token).toString("hex");
}

export function hashCustomerMagicLinkToken(token: string): string {
  return keyed("freeholder:customer-magic:v1", token).toString("hex");
}

export function hashRecoveryCode(code: string): string {
  return keyed("freeholder:recovery-code:v1", normalizeRecoveryCode(code)).toString("hex");
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-7]/g, "");
}

export function encryptTwoFactorSecret(plain: string): string {
  const key = keyed("freeholder:2fa-encryption-key:v1", "key");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
}

function canonicalBase64Url(value: string, expectedBytes?: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid encrypted two-factor secret.");
  }
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.length === 0 ||
    (expectedBytes !== undefined && decoded.length !== expectedBytes) ||
    decoded.toString("base64url") !== value
  ) {
    throw new Error("Invalid encrypted two-factor secret.");
  }
  return decoded;
}

export function decryptTwoFactorSecret(value: string): string {
  const parts = value.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Invalid encrypted two-factor secret.");
  }
  const iv = canonicalBase64Url(parts[1]!, 12);
  const tag = canonicalBase64Url(parts[2]!, 16);
  const encrypted = canonicalBase64Url(parts[3]!);
  const key = keyed("freeholder:2fa-encryption-key:v1", "key");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString("utf8");
}

function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(value: string): Buffer {
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const character of value.toUpperCase().replace(/=|\s|-/g, "")) {
    const digit = BASE32.indexOf(character);
    if (digit < 0) throw new Error("Invalid base32 secret.");
    accumulator = (accumulator << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCode(secretValue: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", base32Decode(secretValue)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

export function matchingTotpStep(
  secretValue: string,
  code: string,
  now = Date.now(),
): number | undefined {
  if (!/^\d{6}$/.test(code)) return undefined;
  const current = Math.floor(now / 30_000);
  const supplied = Buffer.from(code);
  for (const step of [current - 1, current, current + 1]) {
    const expected = Buffer.from(totpCode(secretValue, step));
    if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) return step;
  }
  return undefined;
}

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = base32Encode(randomBytes(10));
    return raw.match(/.{1,4}/g)!.join("-");
  });
}

export function generateChallengeToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Security administration grants make a stored role privileged. */
export function isPrivilegedGrants(grants: readonly ModuleGrant[]): boolean {
  return grants.some(
    (grant) =>
      grant.access === "manage" &&
      (grant.module === "*" || PRIVILEGED_MODULES.has(grant.module)),
  );
}
