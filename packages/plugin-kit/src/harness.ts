// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Dev harness checks for a plugin folder (C3.12).
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { validatePluginContract } from "./contract";

export const EXAMPLE_KINDS = ["block", "service", "adapter", "automation", "route"] as const;

export type HarnessReport = {
  name: string;
  version: string;
  examples: string[];
  changelog: boolean;
};

export async function inspectPluginFolder(root: string): Promise<HarnessReport> {
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error(`No plugin folder at ${root}.`);
  }
  const raw = JSON.parse(await readFile(join(root, "plugin.json"), "utf8")) as {
    name: string;
    version: string;
    freeholder: string;
    license: string;
    permissions?: string[];
  };
  validatePluginContract(raw);
  const names = await readdir(root);
  const examples = EXAMPLE_KINDS.filter((kind) =>
    names.some((name) => name.toLowerCase().includes(kind)),
  );
  return {
    name: raw.name,
    version: raw.version,
    examples,
    changelog: names.includes("CHANGELOG.md"),
  };
}
