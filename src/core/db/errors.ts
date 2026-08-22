// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Reading a constraint violation back off a failed write.
//
// A unique index is what makes a fact true — one primary location, one live
// key per name, one page per slug — so the service layer's job is not to
// prevent the collision but to translate it. That translation needs the
// constraint's *name*, and getting at it is fiddlier than it looks:
//
//   - drizzle wraps the driver error in a DrizzleQueryError whose `message` is
//     the failed SQL, so matching on the outer message silently never matches;
//   - the name lives on the driver error underneath, reachable through `cause`;
//   - and the two Postgres drivers disagree about what to call it. postgres.js
//     says `constraint_name`, node-postgres says `constraint`.
//
// Each of those is individually obvious and collectively easy to get wrong —
// the failure mode being a caller who gets a page of SQL where they should
// have got one sentence. It lives here, once, because the first two writers of
// it in this codebase both had to discover the same thing.
const MAX_DEPTH = 5;

/** True when this error is Postgres refusing the write named by `constraint`. */
export function violates(error: unknown, constraint: string): boolean {
  for (let current: unknown = error, hops = 0; current && hops < MAX_DEPTH; hops++) {
    const candidate = current as {
      constraint?: unknown;
      constraint_name?: unknown;
      cause?: unknown;
    };
    if (
      candidate.constraint === constraint ||
      candidate.constraint_name === constraint
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

/**
 * Postgres refusing a write because somebody else got there first.
 *
 * Three SQLSTATEs mean the same thing to the person who lost, and which one
 * arrives depends on timing rather than on anything they did:
 *
 *   - `23P01` — an exclusion constraint refused an overlap outright;
 *   - `40001` — the transaction could not be serialised against a concurrent
 *     one and must be retried;
 *   - `40P01` — two transactions deadlocked and Postgres chose a victim.
 *
 * A caller that translates only the first gets a friendly sentence most of the
 * time and a page of SQL the rest of it, which is the worst of both: the bug
 * is invisible in every test that happens not to hit the other two. Whatever
 * the code, the honest answer is the same — the thing you wanted was taken
 * while you were taking it.
 */
export function lostARace(error: unknown): boolean {
  const codes = new Set(["23P01", "40001", "40P01"]);
  for (let current: unknown = error, hops = 0; current && hops < MAX_DEPTH; hops++) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && codes.has(candidate.code)) return true;
    current = candidate.cause;
  }
  return false;
}
