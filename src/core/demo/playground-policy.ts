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
  "cms.touchEditLease", "cms.releaseEditLease", "cms.heartbeatPresence", "cms.leavePresence",
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

/**
 * Whether an environment may deliver mail, SMS or webhooks to the outside
 * world. The disposable playground says no at the service layer as well as at
 * the container network: a background job (a reminder, a compliance reply, a
 * queued webhook) runs as `system`, which the mutation allow-list above
 * deliberately does not cover, and system work must still never make this
 * shared box somebody else's spam cannon.
 */
export function playgroundBlocksExternalDelivery(environment: {
  FREEHOLDER_PLAYGROUND?: string;
}): boolean {
  return environment.FREEHOLDER_PLAYGROUND === "1";
}

/**
 * Row bounds for the surfaces visitors may write, enforced before the
 * mutation opens its transaction. The playground database lives on a bounded
 * tmpfs and resets hourly; a cap per surface keeps one visitor's script from
 * filling it before the reset arrives. The allow-list decides *which*
 * mutations run — this decides when a surface is too full to take one more.
 *
 * Tables are named as strings rather than imported schema objects: this file
 * is imported by the service layer, and importing module schemas here would
 * close a static cycle back into core (the C8.16 lesson — a cycle whose
 * failure is a quiet `undefined` vocabulary in whichever worker hits it
 * first). The names are the drizzle table names; tests assert each cap
 * against the real table, so a rename fails loudly here, not silently.
 */
export interface PlaygroundRowCap {
  /** The physical table whose rows the capped mutation grows. */
  table: string;
  limit: number;
}

export const PLAYGROUND_ROW_CAPS: Readonly<Record<string, PlaygroundRowCap>> = {
  "cms.createPage": { table: "pages", limit: 50 },
  "cms.createFromTemplate": { table: "pages", limit: 50 },
  "cms.createSection": { table: "sections", limit: 100 },
  "cms.saveAsSection": { table: "sections", limit: 100 },
  "forms.create": { table: "forms", limit: 20 },
  "contacts.create": { table: "contacts", limit: 100 },
  "catalog.createProduct": { table: "products", limit: 50 },
  "notes.write": { table: "notes", limit: 200 },
  "tasks.create": { table: "tasks", limit: 100 },
};
