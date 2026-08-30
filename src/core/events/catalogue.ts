// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Every event a trigger may name (MASTER.md §11, §4.17, C9.01).
//
// C9.01 builds automations "over the event registry", and until now there was
// no registry to build over: each manifest declares what it `emits`, boot
// checks what it `listens` to, and nothing ever collected the first list.
// Nothing needed to — a listener is written by a developer who knows the name.
//
// An automation trigger is different. It is chosen by an owner from a menu, so
// the menu has to exist, and it has to come from the manifests rather than a
// hand-kept constant: a hand-kept list is wrong the first time a module adds an
// event, and wrong silently, which is the worst way for a dropdown to be wrong.
//
// Filled by boot rather than by importing `@/modules`. A module reading the
// module index would be a cycle — the index imports every manifest, a manifest
// imports its services, and the service would import the index back — and the
// automations module is exactly the module that needs this list.

export interface CatalogueEvent {
  /** The dotted topic a trigger stores: "catalog.orderPaid". */
  name: string;
  /** Which module emits it, for grouping the picker. */
  module: string;
}

const declared = new Map<string, CatalogueEvent>();

/**
 * Boot records what a module says it emits.
 *
 * Two modules declaring the same name is possible and not an error: the topic
 * is the contract and a trigger on it should fire for either. The first module
 * to claim it is the one shown, which is only a label.
 */
export function registerDeclaredEvents(module: string, names: readonly string[]): void {
  for (const name of names) {
    if (!declared.has(name)) declared.set(name, { name, module });
  }
}

/**
 * Every declared event, sorted.
 *
 * Declared, not observed. An event that has never fired is still a legitimate
 * thing to build an automation for — an owner setting up a refund rule before
 * their first refund is doing exactly the right thing, and a menu built from
 * traffic would be empty precisely when it is most needed.
 */
export function eventCatalogue(): CatalogueEvent[] {
  return [...declared.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function isDeclaredEvent(name: string): boolean {
  return declared.has(name);
}

/** Test seam. Production never calls this. */
export function resetEventCatalogue(): void {
  declared.clear();
}
