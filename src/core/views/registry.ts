// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Which lists can be saved, and what a view of one may hold (C7.06, §4.14).
//
// §4.14: "`SavedView` — a filter someone actually uses, kept. Per user,
// shareable."
//
// The design turns on one existing decision, already written at the top of the
// contacts list: *"Search and filtering are a GET form reading searchParams,
// not client state: it works before JavaScript loads, the back button behaves,
// and a filtered view is a URL somebody can bookmark or send to their
// bookkeeper."*
//
// A saved view is therefore **a named URL**, not a second filtering mechanism.
// The query string stays the state; saving one captures the parameters that are
// already there, and opening one navigates back to them. That is what makes the
// "durable URL/state semantics" C7.06 asks for a property of the design rather
// than a feature bolted on top: the back button, a bookmark, a link pasted to a
// colleague and a saved view are all the same thing.
//
// The registry exists for the two things a URL cannot carry on its own: the
// human names of the parameters, so a view can say what it filters rather than
// showing raw query keys; and the column set, where a list actually has columns.
import type { Actor } from "@/core/service";

export interface ViewFilter {
  /** The query parameter this reads. */
  key: string;
  label: string;
}

export interface ViewColumn {
  key: string;
  label: string;
  /** Columns an owner cannot hide, because the row would stop being clickable. */
  fixed?: boolean;
}

export interface ViewEntity {
  /** Stable; stored on every saved view. */
  key: string;
  label: string;
  /** Where the list lives, so opening a view is a link. */
  path: string;
  /** Which admin module grant this list sits behind. */
  module: string;
  /** The parameters worth naming. Anything else in the URL is still saved. */
  filters: ViewFilter[];
  /**
   * The columns an owner may choose between, if this list has any.
   *
   * Empty for a list that renders rows rather than a table — a column picker
   * over a card layout is a control with nothing to control, and offering one
   * would be worse than not having it.
   */
  columns: ViewColumn[];
  /** What is shown when a view says nothing. */
  defaultColumns: string[];
}

const registry = new Map<string, ViewEntity>();

/**
 * Declare a list as saveable.
 *
 * Core declares its own; a module declares its lists at import time, the same
 * way it registers a contact reference or a segment field. A module that is
 * switched off takes its entity with it, so a saved view of it stops being
 * offered rather than becoming a dead link.
 */
export function registerViewEntity(entity: ViewEntity): void {
  registry.set(entity.key, entity);
}

export function viewEntities(): ViewEntity[] {
  return [...registry.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function viewEntity(key: string): ViewEntity | undefined {
  return registry.get(key);
}

/** Can this person see this list at all? A view of it is worth no more. */
export function mayUseEntity(actor: Actor, entity: ViewEntity): boolean {
  if (actor.kind === "system") return true;
  if (actor.kind !== "user") return false;
  return actor.grants.some(
    (grant) => grant.module === "*" || grant.module === entity.module,
  );
}

/**
 * The parameters worth keeping when a view is saved.
 *
 * Transient things are dropped: `saved` and `error` are one-shot flash markers,
 * and a view that carried them would show "Done." every time anybody opened it.
 * `view` itself goes, because a saved view holding a pointer to a saved view is
 * a loop waiting to be found.
 */
const TRANSIENT = new Set(["saved", "error", "view", "offset"]);

export function meaningfulParams(
  params: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (TRANSIENT.has(key)) continue;
    const single = Array.isArray(value) ? value[0] : value;
    if (typeof single === "string" && single.length > 0) kept[key] = single;
  }
  return kept;
}

/** A view's filters, back as a query string. */
export function toQueryString(filters: Record<string, string>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters).sort()) {
    search.set(key, value);
  }
  return search.toString();
}
