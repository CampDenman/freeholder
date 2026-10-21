// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The customization contract (MASTER.md §39.1, C10.01). An update is only
// safe if the platform knows which parts of a running instance belong to the
// owner. Everything outside these seams is replaceable core.
export const SEAM_IDS = ["database", "plugins", "configuration", "uploads"] as const;
export type SeamId = (typeof SEAM_IDS)[number];

export type PathClass = "core" | "seam" | "ignored";

export interface SeamDefinition {
  id: SeamId;
  holds: string;
  survivesBecause: string;
}

export const CUSTOMIZATION_SEAMS: readonly SeamDefinition[] = [
  {
    id: "database",
    holds: "Pages, settings, media records and every business row",
    survivesBecause: "Structure is data. Swapping the image cannot touch rows.",
  },
  {
    id: "plugins",
    holds: "Owner and third-party code",
    survivesBecause: "Installed artifacts with a compatibility range, never merged into core.",
  },
  {
    id: "configuration",
    holds: "freeholder.config.ts and environment",
    survivesBecause: "Instance choices are checked in or injected, never baked into the image.",
  },
  {
    id: "uploads",
    holds: "Media in object storage",
    survivesBecause: "The container is disposable; media is not on instance disk.",
  },
];

const IGNORED_SEGMENTS = new Set([
  ".data",
  ".git",
  ".next",
  "coverage",
  "dist",
  "node_modules",
  "test-results",
]);

const CORE_ROOTS = new Set(["app", "db", "packages", "scripts", "src"]);

export function normalizeRelativePath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

export function classifyPath(relativePath: string): PathClass {
  const path = normalizeRelativePath(relativePath);
  if (!path) return "ignored";
  const parts = path.split("/");
  if (parts.some((part) => IGNORED_SEGMENTS.has(part))) return "ignored";
  if (path === ".env" || path.startsWith(".env.")) return "seam";
  if (path === "freeholder.config.ts") return "seam";
  if (parts[0] === "plugins") return "seam";
  if (CORE_ROOTS.has(parts[0]!)) return "core";
  return "ignored";
}

export function isUnsupportedCoreEdit(relativePath: string): boolean {
  return classifyPath(relativePath) === "core";
}
