// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Hash replaceable core and detect live edits of it (C10.01).
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { classifyPath, normalizeRelativePath } from "./seams";

export interface CoreInspection {
  digest: string;
  expected: string | null;
  matches: boolean | null;
  modified: string[];
  supported: boolean;
}

export async function hashCoreTree(root: string): Promise<string> {
  const files = await listCoreFiles(root);
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(await readFile(/* turbopackIgnore: true */ join(root, ...file.split("/"))));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

export async function listCoreFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(/* turbopackIgnore: true */ directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(/* turbopackIgnore: true */ directory, entry.name);
      const relativePath = normalizeRelativePath(relative(root, absolute));
      const kind = classifyPath(relativePath);
      if (kind === "ignored") continue;
      if (entry.isDirectory()) {
        if (kind === "seam") continue;
        await walk(absolute);
        continue;
      }
      if (kind === "core") files.push(relativePath);
    }
  }
  await walk(root);
  return files;
}

export function parseGitPorcelain(output: string): string[] {
  const paths: string[] = [];
  for (const raw of output.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const renamed = raw.match(/^R. (.+) -> (.+)$/);
    const path = renamed ? renamed[2]! : raw.slice(3);
    const normalized = normalizeRelativePath(path.replace(/^"|"$/g, ""));
    if (classifyPath(normalized) === "core") paths.push(normalized);
  }
  return paths.sort();
}

export async function gitModifiedCoreFiles(root: string): Promise<string[] | null> {
  const gitDir = await stat(/* turbopackIgnore: true */ join(root, ".git")).catch(() => null);
  if (!gitDir) return null;
  try {
    const output = await new Promise<string>((resolveRun, rejectRun) => {
      const child = spawn("git", ["status", "--porcelain", "-z"], {
        cwd: root,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", rejectRun);
      child.on("exit", (code) => {
        if (code === 0) resolveRun(stdout);
        else rejectRun(new Error(stderr.trim() || `git status exited ${code}`));
      });
    });
    const paths = new Set<string>();
    for (const entry of output.split("\0")) {
      if (!entry.trim()) continue;
      const path = normalizeRelativePath(entry.slice(3).split(" -> ").at(-1) ?? "");
      if (classifyPath(path) === "core") paths.add(path);
    }
    return [...paths].sort();
  } catch {
    return null;
  }
}

export async function inspectCoreFiles(options: {
  root: string;
  expectedDigest?: string | null;
  modified?: string[] | null;
  hash?: boolean;
}): Promise<CoreInspection> {
  const expected = options.expectedDigest ?? null;
  const shouldHash = options.hash ?? expected !== null;
  const digest = shouldHash ? await hashCoreTree(options.root) : "sha256:unverified";
  const matches = expected ? expected === digest : null;
  const modified = [
    ...new Set(
      (options.modified ?? (await gitModifiedCoreFiles(options.root)) ?? []).filter(
        (path) => classifyPath(path) === "core",
      ),
    ),
  ].sort();
  const supported = modified.length === 0 && matches !== false;
  return { digest, expected, matches, modified, supported };
}
