// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What an automation is allowed to do (MASTER.md §4.17, §11, C9.01).
//
// §4.17: "A verb is not an entity. Modules register what they can do at import
// time, exactly as they register a portal room, a reward issuer or a merge
// repoint — core cannot import a module (§11), so the registry lives in core
// and each module claims into it."
//
// **A verb is not the same thing as a service, and the difference is the
// point.** Every service is already registered and callable; if an automation
// could call any of them, then `contacts.merge`, `documents.revokeShare` and
// `invoicing.recordPayment` would all be one dropdown away from an owner
// dragging boxes around a canvas. A verb is a service somebody has decided is
// safe to hand to a rule, described in words an owner reads rather than a
// service name, and labelled with what it touches so §4.17's guardrails can
// reason about it without knowing what it does.
//
// So the registry is deliberately an allow-list. A module gains automation
// verbs by writing them down, and a service that nobody wrote down is not
// reachable from an automation — which is the correct default for a surface
// whose whole purpose is doing things while nobody is watching.
import type { Service } from "@/core/service";

/**
 * What a verb touches, for the guardrails rather than for display.
 *
 * §4.17 says the guardrails are properties of the run, and this is what they
 * read. `messages` is what consent (§4.14) and quiet hours gate; `money` and
 * `destructive` are what the autonomy ladder (§40) requires an approval for at
 * anything below `autonomous`.
 */
export type VerbEffect = "record" | "messages" | "money" | "destructive";

export interface AutomationVerb {
  /** Stable id used in a saved graph. Never the service name — see below. */
  key: string;
  /** The module that claimed it, for grouping and for isolation reporting. */
  module: string;
  /** What an owner reads on the canvas: "Tag the contact". */
  label: string;
  /** One sentence about what happens, in the owner's terms. */
  summary: string;
  effect: VerbEffect;
  /**
   * The service it calls.
   *
   * Held as the service itself rather than a name so a verb naming a service
   * that does not exist is a boot-time error rather than a run-time one. A
   * broken automation must not be discovered by a customer.
   */
  service: Service;
  /**
   * Turn the step's saved parameters and the run's context into service input.
   *
   * A function rather than a shape, because most verbs need the contact the
   * run is about and the saved parameters only carry what the owner chose.
   * Validation of the parameters themselves is the step schema's job.
   */
  buildInput: (params: Record<string, unknown>, context: VerbContext) => unknown;
  /**
   * Whether this verb needs a contact to act on.
   *
   * A schedule-triggered automation has no contact until a step finds one, and
   * "tag the contact" with no contact is a step that would either throw at run
   * time or silently do nothing. Declared here so validation refuses it when
   * the automation is saved.
   */
  requiresContact: boolean;
}

/** What the runtime knows when a step runs. C9.02 fills this in properly. */
export interface VerbContext {
  contactId: string | null;
  /** The event or schedule payload that started the run. */
  trigger: Record<string, unknown>;
  /** Outputs of earlier steps, by node id. */
  steps: Record<string, unknown>;
}

const verbs = new Map<string, AutomationVerb>();

/**
 * A module claims a verb at import time; nothing else may.
 *
 * Registering the same key twice from two modules is a mistake worth failing
 * on rather than a race to win: two meanings for one key means a saved
 * automation does something different depending on module load order, and the
 * automation was saved by somebody who read the first meaning.
 */
export function registerAutomationVerb(verb: AutomationVerb): void {
  const existing = verbs.get(verb.key);
  if (existing) {
    if (existing.module === verb.module && existing.service === verb.service) return;
    throw new Error(
      `two modules both register the automation verb "${verb.key}": "${existing.module}" and "${verb.module}"`,
    );
  }
  if (!/^[a-z][a-z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/.test(verb.key)) {
    throw new Error(
      `automation verb key "${verb.key}" must be dotted lowercase, like "contacts.tag"`,
    );
  }
  verbs.set(verb.key, verb);
}

/** Every verb an automation may use, for the builder's palette. */
export function automationVerbs(): readonly AutomationVerb[] {
  return [...verbs.values()].sort(
    (a, b) => a.module.localeCompare(b.module) || a.key.localeCompare(b.key),
  );
}

export function automationVerb(key: string): AutomationVerb | null {
  return verbs.get(key) ?? null;
}

/** Test seam. Production never calls this. */
export function resetAutomationVerbs(): void {
  verbs.clear();
}
