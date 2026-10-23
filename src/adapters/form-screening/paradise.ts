// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Paradise Modern as one form-screening adapter (C3.33).
//
// Its assessment API requires a form reference and the client's address; the
// submission's prose is the content it screens. That is all that is sent: no
// user agent, no name, no email, phone or other answer.
import { paradiseRequest } from "@/adapters/paradise/http";
import type { ScreeningOutcome, ScreeningRequest } from "./types";

/** MASTER.md §12: a visitor never waits longer than this for a second opinion. */
export const SCREENING_TIMEOUT_MS = 4_000;

export async function assessWithParadise(request: ScreeningRequest): Promise<ScreeningOutcome> {
  try {
    const { body } = await paradiseRequest<{ allow?: unknown }>("/api/shield/assess", {
      timeoutMs: SCREENING_TIMEOUT_MS,
      body: {
        form_id: request.formRef.slice(0, 120),
        client_ip: request.clientIp.slice(0, 64),
        submission: request.message ? { message: request.message.slice(0, 4000) } : {},
      },
    });
    if (body.allow === true) return "allow";
    if (body.allow === false) return "blocked";
    return "unavailable";
  } catch {
    // Unreachable, slow, not enabled for this site, a key problem: none of
    // these is evidence about the visitor. Freeholder's own traps decide.
    return "unavailable";
  }
}
