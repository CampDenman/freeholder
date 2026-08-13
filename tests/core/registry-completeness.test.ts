// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Everything a module defines is everything a module registers.
//
// This exists because the opposite shipped. `core/agents` was written, tested
// and merged with thirteen services that were never added to core's service
// list — and nothing caught it, because every test called the service objects
// directly (`createTask.call(...)`), which works perfectly whether or not the
// registry has ever heard of them.
//
// What was actually broken was everything that goes *through* the registry:
// no HTTP endpoint, no OpenAPI entry, no MCP tool, and no truncation between
// tests for the tables. All of it invisible until somebody tried to call the
// API.
//
// So the guard is not "did we remember" — it is a comparison between two
// things that must agree: what `defineService` produced anywhere in the tree,
// and what boot actually registered. The same for tables.
import { describe, expect, it } from "vitest";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import manifests from "@/modules";
import { listServices } from "@/core/service";
import { isService } from "@/core/boot";
import { ready } from "@/core/runtime";

/** Every service-defining file under a source root. */
async function serviceModules(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (/^(service|services|execution|reset)\.ts$/.test(entry.name)) {
        found.push(path);
      }
    }
  }
  await walk(root);
  return found;
}

describe("the service registry knows everything that exists", () => {
  it("registers every service defined anywhere under src/", async () => {
    await ready();
    const registered = new Set(listServices().keys());

    const modules = [
      ...(await serviceModules("src/core")),
      ...(await serviceModules("src/modules")),
    ];
    expect(modules.length).toBeGreaterThan(5);

    const missing: string[] = [];
    for (const path of modules) {
      // Import by relative specifier so this works the same in CI as locally.
      const imported = (await import(
        `../../${path.replace(/\\/g, "/")}`
      )) as Record<string, unknown>;

      for (const [exportName, value] of Object.entries(imported)) {
        if (exportName === "default") continue;
        if (!isService(value)) continue;
        if (!registered.has(value.def.name)) {
          missing.push(`${value.def.name} (${path} → ${exportName})`);
        }
      }
    }

    // Named exactly, because "one service is missing" is not actionable and
    // the whole point is that somebody forgot which.
    expect(missing).toEqual([]);
  });

  it("registers every table a schema file defines", async () => {
    // Same failure, different surface: a table missing from the barrel is a
    // table `truncateSpine` never clears, which leaks state between tests and
    // surfaces as a flake somewhere unrelated.
    const owned = new Set<string>();
    for (const manifest of manifests) {
      if (!manifest.tables) continue;
      const tables: Record<string, unknown> = await manifest.tables();
      for (const value of Object.values(tables)) {
        if (is(value, PgTable)) owned.add(getTableConfig(value).name);
      }
    }

    const schemas = [
      ...(await schemaFiles("src/core")),
      ...(await schemaFiles("src/modules")),
    ];
    const missing: string[] = [];
    for (const path of schemas) {
      const imported = (await import(
        `../../${path.replace(/\\/g, "/")}`
      )) as Record<string, unknown>;
      for (const [exportName, value] of Object.entries(imported)) {
        if (!is(value, PgTable)) continue;
        const name = getTableConfig(value).name;
        if (!owned.has(name)) missing.push(`${name} (${path} → ${exportName})`);
      }
    }
    expect(missing).toEqual([]);
  });
});

async function schemaFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name === "schema.ts") found.push(path);
    }
  }
  await walk(root);
  return found;
}
