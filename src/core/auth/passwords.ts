// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Password hashing (MASTER.md §9: hand-rolled thin, no auth SaaS). scrypt
// from node:crypto — zero dependencies, memory-hard, boring. The stored
// format is self-describing so parameters can be raised later and old
// hashes verified until their owners next log in.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const N = 16384;
const r = 8;
const p = 1;
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r, p, maxmem: MAXMEM });
  return `scrypt:${N}:${r}:${p}:${salt.toString("base64")}:${key.toString("base64")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltB64, keyB64] = parts;
  const salt = Buffer.from(saltB64!, "base64");
  const expected = Buffer.from(keyB64!, "base64");
  const cost = { N: Number(nStr), r: Number(rStr), p: Number(pStr) };
  // A truncated or corrupted record fails closed. Without this, scrypt throws
  // on a zero-length key or a NaN cost and the caller sees a crash where it
  // asked a yes-or-no question.
  if (salt.length === 0 || expected.length === 0) return false;
  if (!Number.isInteger(cost.N) || cost.N < 2) return false;
  if (!Number.isInteger(cost.r) || cost.r < 1) return false;
  if (!Number.isInteger(cost.p) || cost.p < 1) return false;

  const key = await scrypt(password, salt, expected.length, {
    ...cost,
    maxmem: MAXMEM,
  });
  return timingSafeEqual(key, expected);
}
