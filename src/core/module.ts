// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The module contract (MASTER.md §11). A module is a folder with a manifest;
// modules register capabilities, core wires them. Modules communicate only
// via the event bus and core services — never by importing each other's
// internals. Boot: load manifests → topo-sort by requires → migrate →
// register services → mount routes → subscribe listeners → register jobs →
// build MCP tool list from enabled modules only.
import type { z } from "zod";

type Lazy<T> = () => Promise<T>;

export interface ModuleManifest {
  name: string;
  version: string;
  /** Dependency check at boot; topo-sorted before wiring. */
  requires?: string[];
  /** Drizzle tables owned by this module. */
  tables?: Lazy<Record<string, unknown>>;
  /**
   * The ONLY business-logic entry points: a module whose default export is the
   * array of services to register. Named exports from the same module are
   * where `events.listens` finds its handlers. Typed loosely because it is a
   * dynamic import boundary — boot validates the shape and says plainly what
   * is wrong when it does not match.
   */
  services?: Lazy<Record<string, unknown>>;
  events?: {
    emits?: string[];
    /** event name → handler exported from the module's services. */
    listens?: Record<string, string>;
  };
  /**
   * Block types this module adds to the CMS vocabulary (§24, §32).
   *
   * The default export is an array of `defineBlock` definitions, registered at
   * boot in dependency order — which is why a module contributing blocks must
   * `require` cms. This is the seam §24 promises plugins: a block arrives in
   * the palette, the editor derives its form from its Zod schema, and the
   * editor itself changes not at all.
   */
  blocks?: Lazy<Record<string, unknown>>;
  jobs?: Lazy<Record<string, unknown>>;
  mcpTools?: Lazy<Record<string, unknown>>;
  seo?: { sitemapSources: string[] };
  settingsSchema?: z.ZodType;
  seed?: Lazy<Record<string, unknown>>;
  navigation?: { admin?: unknown[]; portal?: unknown[] };
}

export function defineModule(manifest: ModuleManifest): ModuleManifest {
  return manifest;
}

/**
 * Orders manifests so every module boots after everything it requires.
 * Fails in plain English on unknown or circular dependencies.
 */
export function sortModules(manifests: ModuleManifest[]): ModuleManifest[] {
  const byName = new Map(manifests.map((m) => [m.name, m]));
  const sorted: ModuleManifest[] = [];
  const state = new Map<string, "visiting" | "done">();

  function visit(name: string, path: string[]): void {
    const mark = state.get(name);
    if (mark === "done") return;
    if (mark === "visiting") {
      throw new Error(
        `circular module dependency: ${[...path, name].join(" → ")}`,
      );
    }
    const manifest = byName.get(name);
    if (!manifest) {
      throw new Error(
        `module "${path[path.length - 1]}" requires "${name}", which is not installed`,
      );
    }
    state.set(name, "visiting");
    for (const dep of manifest.requires ?? []) {
      visit(dep, [...path, name]);
    }
    state.set(name, "done");
    sorted.push(manifest);
  }

  for (const manifest of manifests) {
    visit(manifest.name, []);
  }
  return sorted;
}
