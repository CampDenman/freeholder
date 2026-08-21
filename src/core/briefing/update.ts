// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Whether a newer Freeholder exists (MASTER.md §39.3, §42).
//
// One function, deliberately, because two parts of the platform want the same
// answer at different times: the briefing wants it each morning (C4.16), and
// the update screen wants it on demand (C10.11). Both ask here.
//
// The check itself — a jittered GET of a signed static file that says nothing
// about this instance, no identifier, no telemetry — is C10.04. Until that
// lands this answers "nothing known", and every caller already handles that:
// it is the same answer an instance running the newest release gets.

export interface PendingUpdate {
  version: string;
  /** One plain sentence about what the release changes. */
  summary?: string;
  /** Security releases outrank an ordinary one wherever they are shown. */
  security: boolean;
}

export async function pendingUpdate(): Promise<PendingUpdate | null> {
  return null;
}
