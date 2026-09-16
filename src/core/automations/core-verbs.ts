// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What core itself lets an automation do (MASTER.md §4.17, C9.01).
//
// A module claims its own verbs; these are core's, so they live here. They are
// deliberately few and deliberately dull — the spine's own nouns, nothing that
// moves money and nothing that reaches a person. Messaging, invoicing and the
// rest contribute their own as those modules take up the seam, and each of
// those is a decision somebody makes on purpose rather than a side effect of
// having written a service.
//
// The allow-list argument from `verbs.ts` is the whole reason this file is
// short. `contacts.merge` and `contacts.update` are perfectly good services and
// neither belongs one dropdown away from an owner dragging boxes on a canvas.
import { updateContact } from "@/core/contacts/service";
import { writeNote } from "@/core/notes/service";
import { createTask } from "@/core/tasks/service";
import { registerAutomationVerb } from "./verbs";

/**
 * A saved parameter as text, or nothing.
 *
 * Params are `unknown` because they come from a saved graph, and coercing one
 * with `String()` turns an object into the literal text "[object Object]" —
 * which would then be written into somebody's note as though it were what the
 * owner meant. An empty string fails the service's own validation instead,
 * which is the honest outcome.
 */
function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

registerAutomationVerb({
  key: "contacts.setStage",
  module: "core",
  label: "Move the contact to a lifecycle stage",
  summary: "Set where this person sits in the pipeline.",
  effect: "record",
  service: updateContact,
  requiresContact: true,
  // One field, deliberately. `contacts.update` takes the whole `tags` array,
  // so a "tag the contact" verb built on it would silently drop every tag it
  // did not know about — a data loss an owner would attribute to something
  // else entirely. Adding a tag properly needs an `addTags` input on the
  // contact contract, which belongs with the runtime rather than here.
  buildInput: (params, context) => ({
    id: context.contactId,
    lifecycleStage: params.stage,
  }),
});

registerAutomationVerb({
  key: "contacts.note",
  module: "core",
  label: "Write a note on the contact",
  summary: "Leave a note on the timeline, so a person sees why this happened.",
  effect: "record",
  service: writeNote,
  requiresContact: true,
  buildInput: (params, context) => ({
    subjectType: "contact",
    subjectId: context.contactId,
    body: asText(params.body),
  }),
});

registerAutomationVerb({
  key: "tasks.create",
  module: "core",
  label: "Create a task",
  summary: "Put something on the owner's list, optionally about this contact.",
  effect: "record",
  service: createTask,
  // A task is a legitimate outcome of a nightly automation with nobody
  // attached, so this one does not require a contact.
  requiresContact: false,
  buildInput: (params, context) => ({
    title: asText(params.title),
    // Both or neither: `tasks.create` refuses half a subject, and a scheduled
    // automation legitimately has no contact to name.
    ...(context.contactId
      ? { subjectType: "contact" as const, subjectId: context.contactId }
      : {}),
    ...(params.dueAt ? { dueAt: params.dueAt } : {}),
  }),
});
