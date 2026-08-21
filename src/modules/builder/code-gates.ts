// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The gates a code proposal must pass (MASTER.md §37, C4.20).
//
// §37 is unambiguous about where generated code runs: "the instance does not
// compile code on the box that serves traffic, and a droplet is not a build
// server." So the isolation here is not a sandbox that executes the model's
// output more carefully — it is that the output is **never executed at all**
// on this machine. It is data in a row, and then a branch in the owner's own
// repository, built by their CI.
//
// That leaves these gates as the only thing standing between a model's
// suggestion and an owner's repository, so every one of them is written as a
// refusal with a reason rather than a silent filter. An owner reading "this
// was refused because it writes outside its own plugin directory" learns
// something; a proposal that quietly lost a file teaches them nothing.
//
// Nothing here parses or evaluates the proposed code. These are textual and
// structural checks over strings, deliberately: a gate that had to run the
// code to decide whether the code is safe would be the sandbox §37 rejected.
import {
  PLUGIN_NAME_PATTERN,
  PLUGIN_PERMISSION_PATTERN,
} from "@freeholder/plugin-kit";

export interface ProposedFile {
  path: string;
  contents: string;
}

export interface GateResult {
  /** Stable id, so a refusal reads the same in the admin, the API and a test. */
  gate: string;
  passed: boolean;
  /** Present when it failed: what to change, in the owner's words. */
  detail?: string;
}

/** A plugin is small. These are the ceilings, not targets. */
const MAX_FILES = 40;
const MAX_BYTES = 512 * 1024;
const MAX_FILE_BYTES = 128 * 1024;

/**
 * Modules a plugin has no business importing.
 *
 * Not a security boundary on its own — the code runs on the owner's
 * infrastructure after they merge it, and at that point it is their code.
 * It is a **review** boundary: a plugin that shells out or reads the
 * filesystem is doing something the plugin contract does not cover, and the
 * owner should be told that before they merge rather than after.
 */
const FORBIDDEN_IMPORTS = [
  "node:child_process",
  "child_process",
  "node:fs",
  "node:worker_threads",
  "worker_threads",
  "node:vm",
];

/** Shapes that mean "somebody pasted a credential into a file". */
const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "an OpenAI key", pattern: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: "an Anthropic key", pattern: /\bsk-ant-[A-Za-z0-9-]{20,}\b/ },
  { name: "a GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: "an AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "a private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    name: "a hardcoded secret",
    pattern: /\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"'\s]{16,}["']/i,
  },
];

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const SPDX_LINE = "SPDX-License-Identifier:";

function isSource(path: string): boolean {
  return SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension));
}

/**
 * Every file lives under this plugin's own directory, and nowhere else.
 *
 * This is the isolation that matters. A proposal that can only write inside
 * `plugins/<name>/` cannot touch core, cannot touch another plugin, and cannot
 * reach the deploy configuration — whatever the model was asked to do, and
 * whatever a customer wrote into a form that ended up in its context.
 */
function pathGate(files: ProposedFile[], pluginName: string): GateResult {
  const root = `plugins/${pluginName}/`;
  const strays = files
    .map((file) => file.path)
    .filter(
      (path) =>
        !path.startsWith(root) ||
        path.includes("..") ||
        path.startsWith("/") ||
        path.includes("\\") ||
        // A path that normalises to something else is a path that is lying.
        path.split("/").some((segment) => segment === "" || segment === "."),
    );
  return strays.length === 0
    ? { gate: "paths", passed: true }
    : {
        gate: "paths",
        passed: false,
        detail: `Everything a plugin proposes must live under ${root}. These do not: ${strays
          .slice(0, 5)
          .join(", ")}.`,
      };
}

/** A plugin the platform can actually load, declared the way §24 requires. */
function manifestGate(files: ProposedFile[], pluginName: string): GateResult {
  const manifest = files.find(
    (file) => file.path === `plugins/${pluginName}/manifest.ts`,
  );
  if (!manifest) {
    return {
      gate: "manifest",
      passed: false,
      detail: `A plugin needs plugins/${pluginName}/manifest.ts declaring it with definePlugin.`,
    };
  }
  if (!manifest.contents.includes("definePlugin")) {
    return {
      gate: "manifest",
      passed: false,
      detail: "The manifest must declare the plugin with definePlugin from @freeholder/plugin-kit.",
    };
  }
  if (!/kind:\s*["']plugin["']/.test(manifest.contents)) {
    return {
      gate: "manifest",
      passed: false,
      detail: 'The manifest must declare kind: "plugin".',
    };
  }
  if (!/freeholder:\s*["'][^"']+["']/.test(manifest.contents)) {
    return {
      gate: "manifest",
      passed: false,
      detail:
        "The manifest must say which Freeholder versions it supports, so an update can refuse an incompatible plugin rather than breaking on boot.",
    };
  }
  if (!/license:\s*["'][^"']+["']/.test(manifest.contents)) {
    return {
      gate: "manifest",
      passed: false,
      detail: "The manifest must declare a licence.",
    };
  }
  return { gate: "manifest", passed: true };
}

/**
 * Every permission the plugin asks for is one the contract recognises.
 *
 * The point is not that an unrecognised permission is dangerous — it is that
 * it is *meaningless*, and a plugin asking for something the platform cannot
 * grant will fail at install with a worse error than this one.
 */
function permissionsGate(files: ProposedFile[], pluginName: string): GateResult {
  const manifest = files.find(
    (file) => file.path === `plugins/${pluginName}/manifest.ts`,
  );
  if (!manifest) return { gate: "permissions", passed: true };
  const block = /permissions:\s*\[([^\]]*)\]/.exec(manifest.contents);
  if (!block) return { gate: "permissions", passed: true };
  const asked = [...block[1]!.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]!);
  const unknown = asked.filter((permission) => !PLUGIN_PERMISSION_PATTERN.test(permission));
  return unknown.length === 0
    ? { gate: "permissions", passed: true }
    : {
        gate: "permissions",
        passed: false,
        detail: `These are not permissions Freeholder can grant: ${unknown.join(", ")}.`,
      };
}

/** No credential ever travels in a proposal, not even a fake one. */
function secretsGate(files: ProposedFile[]): GateResult {
  for (const file of files) {
    for (const { name, pattern } of SECRET_PATTERNS) {
      if (pattern.test(file.contents)) {
        return {
          gate: "secrets",
          passed: false,
          // Deliberately says where and what kind, never the value.
          detail: `${file.path} looks like it contains ${name}. Secrets belong in the environment (§17), never in a file.`,
        };
      }
    }
  }
  return { gate: "secrets", passed: true };
}

/** Imports that mean the plugin is doing something the contract does not cover. */
function importsGate(files: ProposedFile[]): GateResult {
  const found: string[] = [];
  for (const file of files.filter((candidate) => isSource(candidate.path))) {
    for (const forbidden of FORBIDDEN_IMPORTS) {
      const pattern = new RegExp(
        `(?:from|require\\()\\s*["']${forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
      );
      if (pattern.test(file.contents)) found.push(`${file.path} imports ${forbidden}`);
    }
    if (/\beval\s*\(/.test(file.contents)) found.push(`${file.path} calls eval`);
    if (/new\s+Function\s*\(/.test(file.contents)) {
      found.push(`${file.path} builds a function from a string`);
    }
  }
  return found.length === 0
    ? { gate: "imports", passed: true }
    : {
        gate: "imports",
        passed: false,
        detail: `A plugin runs inside Freeholder, not beside it: ${found.slice(0, 5).join("; ")}.`,
      };
}

/** §Licensing: every source file carries its SPDX header. */
function licenceGate(files: ProposedFile[]): GateResult {
  const missing = files
    .filter((file) => isSource(file.path))
    .filter((file) => !file.contents.slice(0, 400).includes(SPDX_LINE))
    .map((file) => file.path);
  return missing.length === 0
    ? { gate: "licence", passed: true }
    : {
        gate: "licence",
        passed: false,
        detail: `Every source file needs an SPDX header. Missing from: ${missing
          .slice(0, 5)
          .join(", ")}.`,
      };
}

/** A proposal that is enormous is a proposal nobody will read before merging. */
function sizeGate(files: ProposedFile[]): GateResult {
  const bytes = files.reduce((total, file) => total + Buffer.byteLength(file.contents), 0);
  if (files.length > MAX_FILES) {
    return {
      gate: "size",
      passed: false,
      detail: `${files.length} files is more than a reviewable plugin. The ceiling is ${MAX_FILES}.`,
    };
  }
  const oversized = files.find(
    (file) => Buffer.byteLength(file.contents) > MAX_FILE_BYTES,
  );
  if (oversized) {
    return {
      gate: "size",
      passed: false,
      detail: `${oversized.path} is larger than a file anybody reviews properly.`,
    };
  }
  return bytes <= MAX_BYTES
    ? { gate: "size", passed: true }
    : {
        gate: "size",
        passed: false,
        detail: `A proposal is capped at ${Math.round(MAX_BYTES / 1024)} KB; this one is ${Math.round(bytes / 1024)} KB.`,
      };
}

/** A migration a plugin owns is forward-only and named in its manifest (§16). */
function migrationsGate(files: ProposedFile[], pluginName: string): GateResult {
  const migrations = files.filter((file) =>
    file.path.startsWith(`plugins/${pluginName}/migrations/`),
  );
  if (migrations.length === 0) return { gate: "migrations", passed: true };
  const destructive = migrations.find((file) =>
    /\b(drop\s+table|drop\s+column|truncate)\b/i.test(file.contents),
  );
  return destructive
    ? {
        gate: "migrations",
        passed: false,
        // §37: "If a change cannot be undone in one step, the builder refuses
        // it and says why — destructive migrations included."
        detail: `${destructive.path} drops or truncates data. Migrations are forward-only, and a change that cannot be undone in one step is refused (§16).`,
      }
    : { gate: "migrations", passed: true };
}

export interface GateReport {
  pluginName: string;
  results: GateResult[];
  passed: boolean;
  /** The first reason, for a screen with room for one line. */
  refusal?: string;
}

/**
 * Run every gate, and report all of them rather than stopping at the first.
 *
 * An owner who fixes one refusal and immediately meets another learns the
 * process is adversarial. Seeing the whole list at once is what makes it a
 * review.
 */
export function runCodeGates(
  files: ProposedFile[],
  pluginName: string,
): GateReport {
  const nameOk = PLUGIN_NAME_PATTERN.test(pluginName);
  const results: GateResult[] = [
    nameOk
      ? { gate: "name", passed: true }
      : {
          gate: "name",
          passed: false,
          detail: `"${pluginName}" is not a plugin name. Use lowercase words joined by hyphens.`,
        },
    files.length > 0
      ? { gate: "content", passed: true }
      : { gate: "content", passed: false, detail: "The proposal contains no files." },
    pathGate(files, pluginName),
    manifestGate(files, pluginName),
    permissionsGate(files, pluginName),
    secretsGate(files),
    importsGate(files),
    licenceGate(files),
    sizeGate(files),
    migrationsGate(files, pluginName),
  ];
  const failed = results.filter((result) => !result.passed);
  return {
    pluginName,
    results,
    passed: failed.length === 0,
    refusal: failed[0]?.detail,
  };
}

export interface FileDiff {
  path: string;
  addedLines: number;
  bytes: number;
}

/**
 * What the owner reads before deciding.
 *
 * Every file is new, because a plugin proposal creates a directory that did
 * not exist — there is nothing to diff against, and pretending otherwise with
 * a `+`-prefixed wall of text would be theatre. What matters is the shape:
 * which files, how big, and what the plugin says it wants to be allowed to do.
 */
export function describeProposal(
  files: ProposedFile[],
  pluginName: string,
): { files: FileDiff[]; permissions: string[]; totalAddedLines: number } {
  const manifest = files.find(
    (file) => file.path === `plugins/${pluginName}/manifest.ts`,
  );
  const block = manifest ? /permissions:\s*\[([^\]]*)\]/.exec(manifest.contents) : null;
  const permissions = block
    ? [...block[1]!.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]!)
    : [];
  const described = files.map((file) => ({
    path: file.path,
    addedLines: file.contents.split("\n").length,
    bytes: Buffer.byteLength(file.contents),
  }));
  return {
    files: described,
    permissions,
    totalAddedLines: described.reduce((total, file) => total + file.addedLines, 0),
  };
}
