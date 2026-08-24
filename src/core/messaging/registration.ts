// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What a number must be registered for before it can send (§4.14, C7.11).
//
// §4.14: "Registration is part of setup, not a surprise. US 10DLC brand and
// campaign registration, toll-free verification, and alphanumeric sender IDs
// where they apply are tracked on `MessagingNumber` with their status surfaced
// in the admin — an unregistered number silently filtered by carriers is the
// most common way an SMS launch fails."
//
// The reason that failure is so common is worth stating, because it decides the
// shape of this file. An unregistered US number does not bounce. It accepts the
// message, returns a success, bills the account, and then the carrier drops it
// somewhere the sender cannot see. Every signal a normal integration relies on
// says the message went out. The only way to catch it is to know the rules
// *before* sending — which is what this file is.
//
// So the requirement is derived, not stored: a pure function of country and
// number kind. Storing "this number needs 10DLC" as a flag somebody sets would
// mean an owner could clear it, and the whole point is that the rule is not
// theirs to waive.
//
// **The rules here are US and Canadian carrier policy as of 2026 and they will
// change.** They are in one function with one test file so that when they do,
// there is one place to correct and the correction is visible in a diff.

/** What a number can be required to complete before it may send. */
export const REGISTRATION_KINDS = [
  /** US A2P 10DLC: a brand *and* a campaign, both approved. */
  "10dlc",
  /** US/CA toll-free verification. */
  "toll_free_verification",
  /** An alphanumeric sender ID, where the country allows one at all. */
  "sender_id",
] as const;

export type RegistrationKind = (typeof REGISTRATION_KINDS)[number];

/**
 * Where a registration has got to.
 *
 * `not_required` is a first-class answer rather than the absence of one: a UK
 * long code needs nothing, and a screen that shows it as "not started" would
 * send an owner looking for a form that does not exist.
 */
export const REGISTRATION_STATES = [
  "not_required",
  "not_started",
  "submitted",
  "in_review",
  "approved",
  "rejected",
  "expired",
] as const;

export type RegistrationState = (typeof REGISTRATION_STATES)[number];

/** The states in which a number may actually be used to send. */
const SENDABLE: ReadonlySet<RegistrationState> = new Set(["not_required", "approved"]);

export interface RegistrationRequirement {
  kind: RegistrationKind;
  /** What an owner has to do, in their words, with somewhere to do it. */
  guidance: string;
}

/**
 * Countries that permit an alphanumeric sender ID at all.
 *
 * Deliberately a small allow-list rather than a deny-list of the two that
 * forbid it: the honest default for a country nobody has checked is "we do not
 * know", and an allow-list fails towards refusing to send rather than towards
 * sending into a carrier's filter. Adding a country is one line and a test.
 */
const SENDER_ID_COUNTRIES: ReadonlySet<string> = new Set([
  "GB", "IE", "FR", "DE", "ES", "IT", "NL", "BE", "PT", "AT", "CH", "SE", "NO",
  "DK", "FI", "PL", "CZ", "GR", "AU", "NZ", "ZA", "IN", "AE", "SG",
]);

/** Countries whose long codes need A2P 10DLC registration. */
const TEN_DLC_COUNTRIES: ReadonlySet<string> = new Set(["US"]);

/** Countries whose toll-free numbers need verification before they will deliver. */
const TOLL_FREE_VERIFICATION_COUNTRIES: ReadonlySet<string> = new Set(["US", "CA"]);

/**
 * What this number must complete before it may send.
 *
 * An empty list means nothing is required — most of the world, for most kinds
 * of number. A null country means the provider did not say, and that is treated
 * as unknown rather than as "nowhere in particular": a number whose country
 * nobody knows cannot be checked against a country's rules, and pretending
 * otherwise is how an unregistered US number gets through.
 */
export function requirementsFor(input: {
  country: string | null;
  kind: "long_code" | "toll_free" | "short_code" | "alphanumeric";
}): RegistrationRequirement[] {
  const country = input.country?.toUpperCase() ?? null;

  if (input.kind === "alphanumeric") {
    if (!country || !SENDER_ID_COUNTRIES.has(country)) {
      return [
        {
          kind: "sender_id",
          guidance: country
            ? `Sender names are not accepted in ${country}. Use an ordinary number there instead — messages sent from a sender name will be filtered without warning.`
            : "This sender name has no country recorded, so there is no way to tell whether it is accepted. Set the country, or use an ordinary number.",
        },
      ];
    }
    // Allowed, and in most of these countries pre-registration is required or
    // strongly advised; the status is the owner's to record either way.
    return [
      {
        kind: "sender_id",
        guidance: `Register this sender name with your provider for ${country}. Unregistered sender names are increasingly filtered, and the filtering is silent.`,
      },
    ];
  }

  if (input.kind === "toll_free" && country && TOLL_FREE_VERIFICATION_COUNTRIES.has(country)) {
    return [
      {
        kind: "toll_free_verification",
        guidance:
          "Submit toll-free verification with your provider. Until it is approved, messages are heavily rate-limited and increasingly blocked outright.",
      },
    ];
  }

  if (input.kind === "long_code" && country && TEN_DLC_COUNTRIES.has(country)) {
    return [
      {
        kind: "10dlc",
        guidance:
          "Register a 10DLC brand and campaign with your provider. Until both are approved, US carriers accept these messages, bill for them, and then drop them — nothing tells you they did not arrive.",
      },
    ];
  }

  // A number with no country at all cannot be checked against anybody's rules.
  if (!country && input.kind !== "short_code") {
    return [
      {
        kind: input.kind === "toll_free" ? "toll_free_verification" : "10dlc",
        guidance:
          "This number has no country recorded, so there is no way to tell what it must be registered for. Read your numbers in again, or set the country by hand.",
      },
    ];
  }

  return [];
}

/** One number's registration, as it is stored. */
export interface RegistrationRecord {
  kind: RegistrationKind;
  state: RegistrationState;
  /** The brand or business identity the provider approved. 10DLC only. */
  brand?: string | null;
  /** The campaign or use case. 10DLC only. */
  campaign?: string | null;
  /** The provider's own reference, so an owner can quote it in support. */
  providerRef?: string | null;
  submittedAt?: string | null;
  decidedAt?: string | null;
  /** Why it was rejected, verbatim, because "rejected" alone is unactionable. */
  reason?: string | null;
}

export interface SendVerdict {
  allowed: boolean;
  /** What is wrong and what to do about it, or null when nothing is. */
  problem: string | null;
  /** What is still outstanding, for a screen to list. */
  outstanding: RegistrationKind[];
}

/**
 * May this number send right now?
 *
 * The rule is the one §4.14 asks for: **required and not approved means no.**
 * Not "warn and send" — the whole failure this prevents is a message that looks
 * sent and is not, and a warning an owner clicks past reproduces it exactly.
 *
 * A missing record for a required registration is treated as `not_started`
 * rather than as an error, because that is what it means: nobody has begun.
 */
export function maySend(input: {
  country: string | null;
  kind: "long_code" | "toll_free" | "short_code" | "alphanumeric";
  registrations: readonly RegistrationRecord[];
}): SendVerdict {
  const required = requirementsFor(input);
  if (required.length === 0) return { allowed: true, problem: null, outstanding: [] };

  const outstanding: RegistrationKind[] = [];
  const problems: string[] = [];
  for (const requirement of required) {
    const record = input.registrations.find((one) => one.kind === requirement.kind);
    const state = record?.state ?? "not_started";
    if (SENDABLE.has(state)) continue;
    outstanding.push(requirement.kind);
    problems.push(
      state === "rejected" && record?.reason
        ? `${requirement.guidance} It was rejected: ${record.reason}`
        : requirement.guidance,
    );
  }

  return outstanding.length === 0
    ? { allowed: true, problem: null, outstanding: [] }
    : { allowed: false, problem: problems.join(" "), outstanding };
}

/** How far along everything is, for a screen that has to show one badge. */
export function overallState(input: {
  country: string | null;
  kind: "long_code" | "toll_free" | "short_code" | "alphanumeric";
  registrations: readonly RegistrationRecord[];
}): RegistrationState {
  const required = requirementsFor(input);
  if (required.length === 0) return "not_required";
  const states = required.map(
    (requirement) =>
      input.registrations.find((one) => one.kind === requirement.kind)?.state ?? "not_started",
  );
  // The worst wins: a number with one approved registration and one rejected is
  // rejected, because that is the one an owner has to act on.
  for (const state of ["rejected", "expired", "not_started", "submitted", "in_review"] as const) {
    if (states.includes(state)) return state;
  }
  return "approved";
}
