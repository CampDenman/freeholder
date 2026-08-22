// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Honeypot and time trap (MASTER.md §36: "honeypots + time-traps + optional
// Turnstile on every form … submission quarantine queue").
//
// Two traps that cost a visitor nothing: no puzzle, no third-party script, no
// tracking, and nothing that fails for somebody using a screen reader or a
// slow connection. They catch the bulk of automated submissions, which is all
// they are for — a determined human spammer defeats both, and the answer to
// that is the quarantine queue rather than a harder puzzle.
//
// Neither trap *rejects*. They flag, and the submission is stored either way
// (§36's quarantine): a false positive that silently discards a real enquiry
// costs an owner a customer, which is worse than the spam it prevented.
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/core/env";

/**
 * The hidden field's name.
 *
 * It used to be `website_url`, which was a mistake worth explaining because
 * the reasoning that produced it is so plausible: name the trap after
 * something a bot's field-matcher wants to fill.
 *
 * The trouble is that a browser's autofill is also a field-matcher, and a far
 * better one. Safari on iOS, 1Password, Bitwarden and Chrome all recognise
 * "url" and "website" and will fill them from a saved card — and
 * `autocomplete="off"` does not stop them, because it is advisory and iOS in
 * particular ignores it. A real person accepting their own contact card would
 * have had the trap filled *for* them and their enquiry flagged as spam.
 *
 * So the name is now one no heuristic reaches for: no url, website, email,
 * name, address, phone, user or organisation in it, and nothing a password
 * manager treats as a field worth completing. The attribute soup on the input
 * itself (see `block.tsx`) is the belt to this braces.
 */
export const HONEYPOT_FIELD = "entry_ref";

/**
 * Terms a browser or password manager matches on when deciding what to fill.
 *
 * Exported so the gate can assert the honeypot's name contains none of them,
 * rather than a future maintainer having to remember why the name is odd.
 */
export const AUTOFILL_TERMS = [
  "url",
  "website",
  "web",
  "email",
  "mail",
  "name",
  "user",
  "login",
  "pass",
  "phone",
  "tel",
  "mobile",
  "address",
  "street",
  "city",
  "state",
  "zip",
  "postal",
  "country",
  "company",
  "organization",
  "organisation",
  "title",
  "card",
  "cc",
  "birthday",
  "given",
  "family",
  "nickname",
] as const;

/** The signed timestamp field. */
export const STAMP_FIELD = "form_stamp";

/**
 * Below this, a submission was not typed by a person.
 *
 * Three seconds is deliberately low. The trap is aimed at scripts that POST
 * within milliseconds of a GET; setting it high enough to catch a fast human
 * would start catching fast humans.
 */
const MINIMUM_SECONDS = 3;

/** Above this, the page was left open long enough that the stamp is stale. */
const MAXIMUM_SECONDS = 60 * 60 * 12;

function sign(payload: string): string {
  const secret = env().SESSION_SECRET ?? "development-only-form-stamp-secret";
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * A timestamp the visitor's browser carries but cannot usefully forge.
 *
 * Signed because an unsigned one is worthless: a bot that reads the field can
 * post any value it likes, including one from four seconds ago. This costs one
 * HMAC per render and removes the entire class of bypass.
 */
export function issueStamp(now = new Date()): string {
  const issued = String(now.getTime());
  return `${issued}.${sign(issued)}`;
}

export interface SpamVerdict {
  /** True when at least one trap fired. */
  suspected: boolean;
  /** Which ones, in words an owner reviewing the queue can act on. */
  reasons: string[];
}

/**
 * Read the traps. Never throws — a malformed stamp is itself a signal.
 */
export function inspect(
  values: Record<string, unknown>,
  now = new Date(),
): SpamVerdict {
  const reasons: string[] = [];

  const honeypot = values[HONEYPOT_FIELD];
  if (typeof honeypot === "string" && honeypot.trim() !== "") {
    reasons.push("filled in a field that is hidden from people");
  }

  const stamp = values[STAMP_FIELD];
  if (typeof stamp !== "string" || !stamp.includes(".")) {
    reasons.push("submitted without the form's timestamp");
    return { suspected: reasons.length > 0, reasons };
  }

  const [issued = "", signature = ""] = stamp.split(".");
  const expected = sign(issued);
  const provided = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (
    provided.length !== wanted.length ||
    !timingSafeEqual(provided, wanted)
  ) {
    reasons.push("submitted with a timestamp this site did not issue");
    return { suspected: true, reasons };
  }

  const elapsed = (now.getTime() - Number(issued)) / 1000;
  if (!Number.isFinite(elapsed)) {
    reasons.push("submitted with an unreadable timestamp");
  } else if (elapsed < MINIMUM_SECONDS) {
    // Whole seconds, via Math.round rather than toFixed: §15.4's money gate
    // forbids toFixed outright, and a rule with an exemption for "but this one
    // is not money" is a rule somebody will reach for next time it is.
    reasons.push(`submitted ${Math.round(elapsed)}s after the page loaded`);
  } else if (elapsed > MAXIMUM_SECONDS) {
    // Not spam so much as stale — an open tab from yesterday. Flagged rather
    // than refused, because the person is real and their answer is real.
    reasons.push("submitted from a page that had been open for over 12 hours");
  }

  return { suspected: reasons.length > 0, reasons };
}
