// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Directory hash and optional signature for plugin install (C3.09).
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

export async function hashDirectory(root: string): Promise<string> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    // Plugin directories are selected by the owner after deployment. These
    // comments keep the build tracer from treating each variable path as a
    // request to package every file under the repository root.
    const entries = await readdir(/* turbopackIgnore: true */ dir, {
      withFileTypes: true,
    });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const path = join(/* turbopackIgnore: true */ dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files.push(path);
    }
  }
  await walk(root);
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(relative(root, file).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(await readFile(/* turbopackIgnore: true */ file));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

export async function assertDirectory(path: string): Promise<void> {
  const info = await stat(/* turbopackIgnore: true */ path).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error(`No plugin directory at ${path}.`);
  }
}

export function signIntegrity(integrity: string, secret: string): string {
  return `sha256:${createHmac("sha256", secret).update(integrity).digest("hex")}`;
}

export function verifySignature(integrity: string, signature: string, secret: string): boolean {
  const expected = signIntegrity(integrity, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
