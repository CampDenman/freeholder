// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Provider I/O must not run while defineService owns a database transaction.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type FunctionNode =
  | ts.ArrowFunction
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.MethodDeclaration;

const PROVIDER_METHODS = new Set([
  "health",
  "identity",
  "listInteractions",
  "listOwnedPosts",
  "listReviews",
  "publish",
  "pushHours",
  "send",
  "verifySender",
  "exchangeCode",
]);
const PROVIDER_FUNCTIONS = new Set([
  "accessTokenForAccount",
  "accessTokenForAccountOutsideTransaction",
  "downloadSocialMedia",
  "exchangeAuthorizationCode",
  "fetchProviderIdentity",
  "getPinnedBytes",
  "providerContactsForSource",
]);

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

function findings(file: string, text: string): string[] {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const localFunctions = new Map<string, FunctionNode>();
  const handlers: FunctionNode[] = [];

  function collect(node: ts.Node): void {
    const definition = ts.isCallExpression(node) ? node.arguments[0] : undefined;
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      localFunctions.set(node.name.text, node);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && isFunction(node.initializer)) {
      localFunctions.set(node.name.text, node.initializer);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "defineService" &&
      definition &&
      ts.isObjectLiteralExpression(definition)
    ) {
      for (const member of definition.properties) {
        if (
          ts.isPropertyAssignment(member) &&
          propertyName(member.name) === "handler" &&
          isFunction(member.initializer)
        ) {
          handlers.push(member.initializer);
        }
      }
    }
    ts.forEachChild(node, collect);
  }
  collect(source);

  const result: string[] = [];
  const visited = new Set<number>();
  function inspect(fn: FunctionNode): void {
    if (visited.has(fn.pos)) return;
    visited.add(fn.pos);
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node)) {
        const called = ts.isIdentifier(node.expression)
          ? node.expression.text
          : ts.isPropertyAccessExpression(node.expression)
            ? node.expression.name.text
            : undefined;
        if (called && (PROVIDER_FUNCTIONS.has(called) || PROVIDER_METHODS.has(called))) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
          result.push(`${file}:${line + 1} ${called}() is reachable from a service transaction`);
        }
        if (called && localFunctions.has(called)) inspect(localFunctions.get(called)!);
      }
      ts.forEachChild(node, visit);
    }
    if (fn.body) visit(fn.body);
  }
  handlers.forEach(inspect);
  return result;
}

describe("long-running service transaction boundary", () => {
  it("detects direct and helper-hidden provider work", () => {
    expect(
      findings(
        "fixture.ts",
        `
          async function hidden(adapter) { return adapter.listReviews("secret"); }
          defineService({ handler: async () => {
            await getPinnedBytes("https://example.test", {});
            await exchangeAuthorizationCode({ code: "single-use" });
            return hidden(adapter);
          }});
        `,
      ),
    ).toHaveLength(3);
  });

  it("keeps catalogue, social, mail and OAuth provider I/O outside service transactions", () => {
    const files = [
      "src/core/catalogue/service.ts",
      "src/core/connections/calendar-oauth.ts",
      "src/core/connections/mail-read-oauth.ts",
      "src/core/import/signup-contact-service.ts",
      "src/core/mail/oauth.ts",
      "src/modules/social/ingest.ts",
      "src/modules/social/gbp.ts",
      "src/modules/social/oauth.ts",
      "src/modules/social/service.ts",
      "src/modules/social/compose.ts",
      "src/core/mail/service.ts",
      "src/modules/reporting/export-service.ts",
    ];
    const found = files.flatMap((file) =>
      findings(file, readFileSync(resolve(process.cwd(), file), "utf8")),
    );
    expect(found, found.join("\n")).toEqual([]);
  });
});
