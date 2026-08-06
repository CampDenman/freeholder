// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
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
