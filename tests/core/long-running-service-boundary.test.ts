// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Provider I/O must not run while defineService owns a database transaction.
//
// The gate scans every file that defines a service — core, modules, plugins
// and app — rather than a list somebody has to remember to extend. Provider
// method names come from the adapter contracts themselves, plus the helper
// functions that wrap provider calls, plus object-storage writes and reads.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type FunctionNode =
  | ts.ArrowFunction
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.MethodDeclaration;

const ROOT = process.cwd();
const SCANNED_ROOTS = ["src", "plugins", "app"];

/**
 * Adapter-contract members that are not provider I/O, or whose names collide
 * with ordinary APIs (Drizzle's `tx.delete`, `Map.get`, `Array.reverse`) so
 * that matching them by name alone would be noise. Object storage is matched
 * by receiver below instead.
 */
const NOT_PROVIDER_IO = new Set([
  "abort",
  "authorizationUrl",
  "capabilities",
  "clientId",
  "clientSecret",
  "collect",
  "complete",
  "create",
  "delete",
  "get",
  "head",
  "interactionUrl",
  "listParts",
  "match",
  "missing",
  "parseIdentity",
  "put",
  "quote",
  "readRange",
  "remove",
  "reverse",
  "signPart",
  "stream",
  "supportedCurrencies",
  "supportedMethods",
  "turn",
  "url",
  "verifyWebhook",
]);

/** Provider methods named on contracts outside `src/adapters`. */
const EXTRA_PROVIDER_METHODS = new Set([
  "listCalendars",
  "listEvents",
  "listHeaders",
]);

const PROVIDER_FUNCTIONS = new Set([
  "accessTokenForAccount",
  "accessTokenForAccountOutsideTransaction",
  "downloadSocialMedia",
  "exchangeAuthorizationCode",
  "fetchProviderIdentity",
  "getPinnedBytes",
  "openPullRequest",
  // Paradise Modern as an optional provider (C3.31–C3.34): every category
  // that uses it goes through this one bounded request.
  "paradiseRequest",
  // The provider-facing steps built on it, so none of them can be moved into
  // a service handler either.
  "assessWithParadise",
  "sealSiteSubmission",
  "sendLeadToParadise",
  "copySubmissionToLeadSink",
  "providerContactsForSource",
]);

/** Object-storage calls that move bytes to or from the store. */
const STORAGE_METHODS = new Set(["put", "delete", "get", "head", "readRange", "stream", "copy"]);

/**
 * Temporary, and only for work already in flight elsewhere. Every entry needs
 * the PR that removes it; nothing else may be added here to make the gate pass.
 */
const ALLOWLIST = new Map<string, string>([]);

function isFunction(node: ts.Node | undefined): node is FunctionNode {
  return Boolean(
    node &&
      (ts.isArrowFunction(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isMethodDeclaration(node)),
  );
}

function propertyName(node: ts.PropertyName): string | undefined {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : undefined;
}

function walk(dir: string, accept: (file: string) => boolean): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const child = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(child, accept));
    else if (accept(child)) found.push(child);
  }
  return found;
}

/** Every function-typed member of every adapter contract. */
function adapterInterfaceMethods(): Set<string> {
  const names = new Set<string>();
  for (const file of walk(resolve(ROOT, "src/adapters"), (path) => path.endsWith(".ts"))) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    function visit(node: ts.Node): void {
      if (ts.isInterfaceDeclaration(node)) {
        for (const member of node.members) {
          const callable =
            ts.isMethodSignature(member) ||
            (ts.isPropertySignature(member) &&
              member.type !== undefined &&
              ts.isFunctionTypeNode(member.type));
          if (
            callable &&
            member.name &&
            (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))
          ) {
            names.add(member.name.text);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return names;
}

const DECLARED = adapterInterfaceMethods();
const PROVIDER_METHODS = new Set(
  [...DECLARED, ...EXTRA_PROVIDER_METHODS].filter((name) => !NOT_PROVIDER_IO.has(name)),
);

/** `storage()` itself, or a local bound to it (`const store = storage()`). */
function isStorageReceiver(node: ts.Expression, storageLocals: Set<string>): boolean {
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "storage"
  ) {
    return true;
  }
  if (ts.isIdentifier(node)) return storageLocals.has(node.text);
  // `storage().directMultipart.complete(...)` and friends.
  if (ts.isPropertyAccessExpression(node)) return isStorageReceiver(node.expression, storageLocals);
  return false;
}

function findings(file: string, text: string): string[] {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const localFunctions = new Map<string, FunctionNode>();
  const storageLocals = new Set<string>();
  const handlers: FunctionNode[] = [];
  const handlerNames: string[] = [];

  function collect(node: ts.Node): void {
    const definition = ts.isCallExpression(node) ? node.arguments[0] : undefined;
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      localFunctions.set(node.name.text, node);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (isFunction(node.initializer)) localFunctions.set(node.name.text, node.initializer);
      if (node.initializer && isStorageReceiver(node.initializer, storageLocals)) {
        storageLocals.add(node.name.text);
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "defineService" &&
      definition &&
      ts.isObjectLiteralExpression(definition)
    ) {
      for (const member of definition.properties) {
        if (ts.isPropertyAssignment(member) && propertyName(member.name) === "handler") {
          if (isFunction(member.initializer)) handlers.push(member.initializer);
          else if (ts.isIdentifier(member.initializer)) handlerNames.push(member.initializer.text);
        }
        if (ts.isShorthandPropertyAssignment(member) && member.name.text === "handler") {
          handlerNames.push("handler");
        }
        if (ts.isMethodDeclaration(member) && propertyName(member.name) === "handler") {
          handlers.push(member);
        }
      }
    }
    ts.forEachChild(node, collect);
  }
  collect(source);

  const result: string[] = [];
  const at = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  for (const name of handlerNames) {
    const fn = localFunctions.get(name);
    if (fn) handlers.push(fn);
  }

  const visited = new Set<FunctionNode>();
  function inspect(fn: FunctionNode): void {
    if (visited.has(fn)) return;
    visited.add(fn);
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const called = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : undefined;
        if (
          ts.isPropertyAccessExpression(callee) &&
          STORAGE_METHODS.has(callee.name.text) &&
          isStorageReceiver(callee.expression, storageLocals)
        ) {
          result.push(`${file}:${at(node)} storage ${callee.name.text}() is reachable from a service transaction`);
        } else if (
          called &&
          // A contract method is a member call (`adapter.send`); a bare
          // `send(...)` is some same-file helper and is followed instead.
          (ts.isIdentifier(callee) ? PROVIDER_FUNCTIONS.has(called) : PROVIDER_METHODS.has(called) || PROVIDER_FUNCTIONS.has(called))
        ) {
          result.push(`${file}:${at(node)} ${called}() is reachable from a service transaction`);
        }
        if (called && ts.isIdentifier(callee) && localFunctions.has(called)) {
          inspect(localFunctions.get(called)!);
        }
      }
      // A same-file helper handed to another call (`items.map(helper)`) runs
      // inside the transaction just the same.
      if (ts.isIdentifier(node) && localFunctions.has(node.text) && ts.isCallExpression(node.parent) && node.parent.arguments.includes(node)) {
        inspect(localFunctions.get(node.text)!);
      }
      ts.forEachChild(node, visit);
    }
    if (fn.body) visit(fn.body);
  }
  handlers.forEach(inspect);
  return result;
}

function serviceFiles(): string[] {
  return SCANNED_ROOTS.flatMap((dir) =>
    walk(resolve(ROOT, dir), (path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)),
  )
    .filter((file) => readFileSync(file, "utf8").includes("defineService"))
    .map((file) => relative(ROOT, file));
}

describe("long-running service transaction boundary", () => {
  it("detects direct, helper-hidden, named-handler and storage provider work", () => {
    expect(
      findings(
        "fixture.ts",
        `
          async function hidden(adapter) { return adapter.listReviews("secret"); }
          defineService({ handler: async () => {
            await getPinnedBytes("https://example.test", {});
            await exchangeAuthorizationCode({ code: "single-use" });
            await paradiseRequest("/api/shield/assess", { body: {} });
            return hidden(adapter);
          }});
        `,
      ),
    ).toHaveLength(4);
    expect(
      findings(
        "fixture.ts",
        `
          const store = storage();
          async function apply(input, ctx) {
            await storage().put("key", input.bytes);
            await store.delete("old");
            await ctx.tx.delete(table);
            return ai.generate({ prompt: input.prompt });
          }
          async function handler(input, ctx) { return apply(input, ctx); }
          defineService({ handler: apply });
          defineService({ handler });
          defineOrchestratedService({ handler: async () => storage().put("fine", bytes) });
        `,
      ),
    ).toEqual([
      "fixture.ts:4 storage put() is reachable from a service transaction",
      "fixture.ts:5 storage delete() is reachable from a service transaction",
      "fixture.ts:7 generate() is reachable from a service transaction",
    ]);
  });

  it("derives provider methods from the adapter contracts", () => {
    // Guards the gate itself: a derivation that stops finding real adapter
    // methods would pass the scan below while checking nothing at all.
    for (const name of [
      "send",
      "createCheckout",
      "exchangeCode",
      "listReviews",
      "suggest",
      "generate",
      "listNumbers",
      "checkNumber",
    ]) {
      expect(PROVIDER_METHODS.has(name), name).toBe(true);
    }
    const stale = [...NOT_PROVIDER_IO].filter((name) => !DECLARED.has(name));
    expect(stale, `no longer declared by any adapter: ${stale.join(", ")}`).toEqual([]);
  });

  it("scans every service file in src, plugins and app", () => {
    const files = serviceFiles();
    expect(files.length).toBeGreaterThan(150);
    expect(files).toContain("src/core/messaging/sms.ts");
    expect(files).toContain("src/core/media/capture.ts");
    expect(files.some((file) => file.startsWith("plugins/"))).toBe(true);
    for (const file of ALLOWLIST.keys()) expect(files).toContain(file);
  });

  it("keeps provider and object-storage I/O outside service transactions", () => {
    const found = serviceFiles()
      .filter((file) => !ALLOWLIST.has(file))
      .flatMap((file) => findings(file, readFileSync(resolve(ROOT, file), "utf8")));
    expect(found, found.join("\n")).toEqual([]);
  });

  it("keeps the allowlist honest", () => {
    // An entry whose file is already clean must be removed, not left to excuse
    // the next regression in it.
    const clean = [...ALLOWLIST.keys()].filter(
      (file) => findings(file, readFileSync(resolve(ROOT, file), "utf8")).length === 0,
    );
    expect(clean, clean.join("\n")).toEqual([]);
  });
});
