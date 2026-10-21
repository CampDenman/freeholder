// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// May this step proceed? (MASTER.md §4.17, §4.14, §40, C9.03)
//
// §4.17: "The guardrails are properties of the run, not of the step kind ... A
// mixed run gets one answer to 'may this proceed', which is the whole reason
// the two kinds share a graph."
//
// So this is one function, asked once, before the step that acts. Not five
// checks scattered through the runtime, and not a different set for prompt
// steps than for deterministic ones — an owner who set quiet hours means them
// whether the message was composed by a model or by a template.
//
// **Nothing here is invented.** Consent is §4.14's `contacts.canContact`,
// quiet hours are §4.14's `messaging.evaluateSmsPolicy`, the ladder is §40's
// `effectiveAutonomy`, and untrusted material goes through §40's
// `untrustedEnvelope`. Reimplementing any of them would be a second answer to
// a question that already has one — and quiet hours in particular is a
// recipient-local, DST-aware calculation that would be wrong the second time.
//
// What is new is the *order*, and that the answer is one verdict rather than
// four independent opinions.
import { getService } from "@/core/service";
import type { ServiceContext } from "@/core/service";
import type { AutomationVerb } from "@/core/automations/verbs";
import { effectiveAutonomy } from "@/core/agents/service";

/** What the runtime does next, having asked. */
export type Verdict =
  | { decision: "proceed" }
  /** Hold the run and put a person in front of it (§40's `approve` rung). */
  | { decision: "approve"; reason: string }
  /** Do not act, and do not ask. The step is refused and recorded. */
  | { decision: "refuse"; reason: string }
  /**
   * Right action, wrong moment. §4.14's quiet hours defer rather than drop:
   * a message held until morning is still the message somebody wanted sent,
   * and dropping it silently is how an owner discovers a feature by its
   * absence.
   */
  | { decision: "defer"; until: Date; reason: string };

export interface GuardInput {
  /** What the step is about to do. */
  verb: Pick<AutomationVerb, "key" | "effect" | "label">;
  /** Who it would reach, when it reaches anybody. */
  contactId: string | null;
  /** The automation's own ceiling, which §40's ladder may only lower. */
  autonomyCeiling: "suggest" | "approve" | "autonomous" | null;
  /**
   * Whether anything in this run came from outside.
   *
   * §4.17: "Untrusted input is data, never instruction ... the person who
   * fills in your contact form does not get to write your agent's brief." A
   * run triggered by a form submission or an inbound message is untrusted for
   * its whole length, not only at the step that reads the field.
   */
  inputTrust: "owner" | "system" | "untrusted";
  /**
   * Whether this run is marketing or follows something the customer did.
   *
   * Stated by the caller rather than guessed. §4.14 requires consent for the
   * first and not the second, and no property of a verb can tell them apart —
   * the same "send an email" is a receipt or a campaign depending on why it is
   * being sent.
   */
  intent?: "transactional" | "marketing";
  /**
   * The contact's phone, when they have one.
   *
   * `evaluateSmsPolicy` validates the destination against the contact's own
   * number, so this is passed rather than looked up: the caller already has
   * the contact and a second read would be the same row twice.
   */
  phone?: string | null;
  /** Minor units this step would spend, when it spends anything. */
  costMinor?: number;
  /** What the automation has left, when it declared a ceiling. */
  budgetRemainingMinor?: number | null;
}

/**
 * Which consent purpose a step needs, if any.
 *
 * `CONSENT_PURPOSES` is `marketing | analytics | data_processing` — there is
 * deliberately no "transactional" purpose, because §4.14 does not require
 * consent for a message that follows something the customer did. A booking
 * confirmation is owed to them; a newsletter is asked of them.
 *
 * So an automation's messaging steps check marketing consent only when the run
 * says it is marketing. C9.06's broadcasts will pass `marketing` for their
 * whole audience; a win-back note attached to a cancelled booking is
 * transactional and does not. Defaulting the other way would either block
 * every confirmation email or wave every campaign through, and both are worse
 * than making the caller say which it is.
 */
function consentPurposeFor(
  effect: AutomationVerb["effect"],
  intent: "transactional" | "marketing",
): "marketing" | null {
  return effect === "messages" && intent === "marketing" ? "marketing" : null;
}

/**
 * Ask once, in this order, and stop at the first thing that says no.
 *
 * The order is not arbitrary. Consent first, because a person who withdrew it
 * should not have their quiet hours consulted — the answer is no either way
 * and the reason should be the true one. Then the money, then the ladder, then
 * the timing: deferring something that was never allowed would tell an owner
 * to expect it later.
 */
export async function mayProceed(
  ctx: ServiceContext,
  input: GuardInput,
): Promise<Verdict> {
  // 1. Consent (§4.14). Only for marketing that reaches somebody.
  const purpose = consentPurposeFor(input.verb.effect, input.intent ?? "transactional");
  if (purpose && input.contactId) {
    const consent = (await ctx.call(getService("contacts.canContact"), {
      contactId: input.contactId,
      purpose,
      channel: null,
    })) as { allowed: boolean; reason: string };
    if (!consent.allowed) {
      return {
        decision: "refuse",
        reason: `Marketing consent is ${consent.reason.replaceAll("_", " ")}.`,
      };
    }
  }

  // 2. The budget. A ceiling that is already spent refuses rather than asks:
  // an approval whose only honest answer is "no, there is no money" wastes the
  // owner's attention, which is the scarcer resource.
  const cost = input.costMinor ?? 0;
  if (cost > 0 && input.budgetRemainingMinor !== null && input.budgetRemainingMinor !== undefined) {
    if (cost > input.budgetRemainingMinor) {
      return {
        decision: "refuse",
        reason: "This automation has spent its budget for the period.",
      };
    }
  }

  // 3. The ladder (§40). `effectiveAutonomy` only ever lowers, and untrusted
  // input pins it at `suggest` whatever anybody configured — the line prompt
  // injection has to cross, drawn in one place rather than re-drawn here.
  const ladder = effectiveAutonomy(
    input.autonomyCeiling ?? "autonomous",
    null,
    input.inputTrust,
  );

  const irreversible = input.verb.effect === "money" || input.verb.effect === "destructive";
  const reaches = input.verb.effect === "messages";

  if (ladder === "suggest") {
    return {
      decision: "approve",
      reason:
        input.inputTrust === "untrusted"
          ? "Something in this run came from outside, so it can only propose."
          : "This automation only suggests.",
    };
  }
  if (ladder === "approve" && (irreversible || reaches)) {
    return {
      decision: "approve",
      reason: `"${input.verb.label}" needs your say-so.`,
    };
  }

  // 4. Quiet hours (§4.14), last, because it is the only one whose answer is
  // "later" rather than "no".
  //
  // Asked only for a contact who has a phone. `evaluateSmsPolicy` validates
  // the destination against the contact's own number and refuses a mismatch —
  // correctly, since a policy answer about the wrong number is worse than
  // none. So an automation that reaches somebody by email is not held by SMS
  // quiet hours, which is right: §4.14's windows are about a phone buzzing at
  // 3am. Email quiet hours are a separate promise the platform does not yet
  // make, and pretending otherwise here would be the wrong kind of quiet.
  if (reaches && input.contactId && input.phone) {
    const policy = (await ctx.call(getService("messaging.evaluateSmsPolicy"), {
      contactId: input.contactId,
      to: input.phone,
      purpose: input.intent === "marketing" ? "marketing" : "transactional",
    })) as { allowed: boolean; reason: string };
    if (!policy.allowed && policy.reason === "quiet_hours") {
      // Until the top of the next hour: the policy knows the window but does
      // not return its end, and an hour is short enough to stay responsive and
      // long enough not to spin.
      const until = new Date();
      until.setMinutes(60, 0, 0);
      return {
        decision: "defer",
        until,
        reason: "It is quiet hours where this person is.",
      };
    }
    if (!policy.allowed) {
      return {
        decision: "refuse",
        reason: `Blocked by the messaging policy: ${policy.reason.replaceAll("_", " ")}.`,
      };
    }
  }

  return { decision: "proceed" };
}
