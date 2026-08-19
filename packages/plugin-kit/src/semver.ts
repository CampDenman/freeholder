// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Semver versions and the ranges a plugin may name (C3.08).
export type Semver = { major: number; minor: number; patch: number };

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;

export function parseSemver(value: string): Semver | null {
  const match = VERSION.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function cmp(a: Semver, b: Semver): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function caretUpper(v: Semver): Semver {
  if (v.major > 0) return { major: v.major + 1, minor: 0, patch: 0 };
  if (v.minor > 0) return { major: 0, minor: v.minor + 1, patch: 0 };
  return { major: 0, minor: 0, patch: v.patch + 1 };
}

function tildeUpper(v: Semver): Semver {
  return { major: v.major, minor: v.minor + 1, patch: 0 };
}

type Comparator = (version: Semver) => boolean;

function comparator(token: string): Comparator | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const caret = trimmed.startsWith("^") ? parseSemver(trimmed.slice(1)) : null;
  if (caret) {
    const upper = caretUpper(caret);
    return (version) => cmp(version, caret) >= 0 && cmp(version, upper) < 0;
  }
  const tilde = trimmed.startsWith("~") ? parseSemver(trimmed.slice(1)) : null;
  if (tilde) {
    const upper = tildeUpper(tilde);
    return (version) => cmp(version, tilde) >= 0 && cmp(version, upper) < 0;
  }
  for (const op of [">=", "<=", ">", "<", "="] as const) {
    if (!trimmed.startsWith(op)) continue;
    const bound = parseSemver(trimmed.slice(op.length));
    if (!bound) return null;
    return (version) => {
      const n = cmp(version, bound);
      if (op === ">=") return n >= 0;
      if (op === "<=") return n <= 0;
      if (op === ">") return n > 0;
      if (op === "<") return n < 0;
      return n === 0;
    };
  }
  const exact = parseSemver(trimmed);
  if (!exact) return null;
  return (version) => cmp(version, exact) === 0;
}

/**
 * npm-style ranges: `1.2.3`, `^1.2.3`, `~1.2.0`, `>=0.0.0`, or
 * space-separated ANDs (`>=1.0.0 <2.0.0`).
 */
export function satisfies(version: string, range: string): boolean {
  const parsed = parseSemver(version);
  if (!parsed) return false;
  const tokens = range.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.every((token) => {
    const check = comparator(token);
    return check ? check(parsed) : false;
  });
}
