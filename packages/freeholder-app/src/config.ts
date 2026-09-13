// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Expo / EAS config mutation and the auditable diff C10.15 requires.
//
// The owner has to be able to see what init changed before they ship a binary.
// A silent rewrite of app.json is how a bundle identifier gets out of sync
// with the store listing; a field-level diff is the whole point of the command.
import type { Branding } from "./branding.js";

export interface DiffEntry {
  op: "add" | "remove" | "change";
  path: string;
  from?: unknown;
  to?: unknown;
}

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export const DEFAULT_EAS: Json = {
  cli: { appVersionSource: "local" },
  build: {
    development: { developmentClient: true, distribution: "internal" },
    preview: { distribution: "internal" },
    production: {},
  },
  submit: { production: {} },
};

export function expoSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "freeholder-customer";
}

/** iOS/Android ids allow letters, digits and dots — not hyphens. */
export function bundleId(name: string): string {
  let stem = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24);
  if (!stem) stem = "customer";
  if (!/^[a-z]/.test(stem)) stem = `app${stem}`;
  return `ai.freeholder.${stem}`;
}

export function brandedExpoConfig(existing: Json, brand: Branding): Json {
  const current = isObject(existing) ? existing : {};
  const expo = isObject(current.expo) ? { ...current.expo } : {};
  const ios = isObject(expo.ios) ? { ...expo.ios } : {};
  const android = isObject(expo.android) ? { ...expo.android } : {};
  const splash = isObject(expo.splash) ? { ...expo.splash } : {};
  const extra = isObject(expo.extra) ? { ...expo.extra } : {};
  const adaptive = isObject(android.adaptiveIcon) ? { ...android.adaptiveIcon } : {};

  expo.name = brand.name;
  expo.slug = expoSlug(brand.name);
  expo.icon = "./assets/icon.png";
  expo.userInterfaceStyle = expo.userInterfaceStyle ?? "automatic";
  expo.orientation = expo.orientation ?? "portrait";
  expo.scheme = typeof expo.scheme === "string" && expo.scheme ? expo.scheme : "freeholder";
  splash.image = "./assets/splash.png";
  splash.resizeMode = "contain";
  splash.backgroundColor = brand.colors.surface;
  expo.splash = splash;
  ios.supportsTablet = ios.supportsTablet ?? true;
  ios.bundleIdentifier = bundleId(brand.name);
  expo.ios = ios;
  android.package = bundleId(brand.name);
  adaptive.foregroundImage = "./assets/adaptive-icon.png";
  adaptive.backgroundColor = brand.colors.surface;
  android.adaptiveIcon = adaptive;
  expo.android = android;
  extra.instanceUrl = brand.url;
  extra.brandName = brand.name;
  expo.extra = extra;

  return { ...current, expo };
}

/** Fill missing EAS keys; never overwrite an existing value (credentials). */
export function mergeEasConfig(existing: Json | null): Json {
  if (!existing || !isObject(existing)) return clone(DEFAULT_EAS);
  return fillMissing(existing, DEFAULT_EAS);
}

export function diffJson(before: Json | null, after: Json, path = ""): DiffEntry[] {
  if (same(before, after)) return [];
  if (!isObject(before) || !isObject(after)) {
    if (before === undefined || before === null) {
      return [{ op: "add", path: path || "(root)", to: after }];
    }
    return [{ op: "change", path: path || "(root)", from: before, to: after }];
  }
  const entries: DiffEntry[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of [...keys].sort()) {
    const child = path ? `${path}.${key}` : key;
    if (!(key in before)) {
      const added = after[key] as Json;
      if (isObject(added)) entries.push(...diffJson({}, added, child));
      else entries.push({ op: "add", path: child, to: added });
    } else if (!(key in after)) {
      entries.push({ op: "remove", path: child, from: before[key] });
    } else entries.push(...diffJson(before[key] as Json, after[key] as Json, child));
  }
  return entries;
}

export function formatDiff(files: { file: string; created: boolean; entries: DiffEntry[] }[]): string {
  const lines: string[] = ["Config diff"];
  for (const file of files) {
    lines.push("");
    lines.push(file.created ? `${file.file}  (created)` : file.file);
    if (file.entries.length === 0) {
      lines.push("  (unchanged)");
      continue;
    }
    for (const entry of file.entries) {
      if (entry.op === "add") lines.push(`  + ${entry.path}: ${preview(entry.to)}`);
      else if (entry.op === "remove") lines.push(`  - ${entry.path}: ${preview(entry.from)}`);
      else lines.push(`  ~ ${entry.path}: ${preview(entry.from)} → ${preview(entry.to)}`);
    }
  }
  return lines.join("\n");
}

function fillMissing(current: { [key: string]: Json }, fallback: Json): Json {
  if (!isObject(fallback)) return current;
  const out: { [key: string]: Json } = { ...current };
  for (const [key, value] of Object.entries(fallback)) {
    if (!(key in out)) out[key] = clone(value);
    else if (isObject(out[key]) && isObject(value)) out[key] = fillMissing(out[key], value);
  }
  return out;
}

function isObject(value: unknown): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone(value: Json): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function preview(value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined) return "undefined";
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}
