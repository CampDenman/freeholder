// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.38: a public playground grants content access, never operator authority.
export const PLAYGROUND_MANAGE = ["cms", "forms", "contacts", "catalog", "notes", "tasks"] as const;
export const PLAYGROUND_VIEW = ["admin", "settings", "events", "analytics", "search", "media", "guidance", "notifications"] as const;

// Explicit opt-in: future services (including CMS email/SMS delivery) must not
// silently inherit permission to run in a publicly editable instance.
const MUTATIONS = new Set([
  "playground.enter", "auth.logout",
  "cms.createPage", "cms.updatePage", "cms.mergePage", "cms.publishPage", "cms.deleteDraftPage",
  "cms.updateSection", "cms.createSectionLocale", "cms.restoreRevision",
  "cms.attachLayout", "cms.detachLayout", "cms.rejoinLayout", "cms.createSection",
  "cms.saveAsSection", "cms.detachSection", "cms.deleteSection", "cms.createFromTemplate",
  "forms.create", "forms.update", "forms.delete", "forms.reviewSubmission",
  "contacts.create", "contacts.update", "contacts.merge", "contacts.undoMerge",
  "catalog.createProduct", "catalog.updateProduct", "catalog.updateProductDescription",
  "catalog.activateProduct", "catalog.publishProduct", "catalog.archiveProduct", "catalog.restoreProduct",
  "notes.write", "notes.edit", "notes.pin", "notes.remove", "notes.restore",
  "tasks.create", "tasks.update", "tasks.setStatus", "tasks.remove", "tasks.restore",
]);

export function playgroundAllows(name: string, kind: "query" | "mutation"): boolean {
  if (kind === "query") return true; // Existing stored grants still authorize reads.
  return MUTATIONS.has(name);
}
