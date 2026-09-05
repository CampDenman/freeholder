// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The one-transaction service-composition boundary (MASTER.md C0.11, C1.09).
//
// A direct `someService.call()` from a service handler opens another database
// transaction on another connection. Besides making half-commits possible, it
// can deadlock an installation whose pool has only one connection. Composition
// inside a handler therefore goes through `ctx.call`/`ctx.callAsSystem`, which
// reuse the caller's transaction and event queue.
//
// Request-cached `*/read` helpers deliberately call a service at their outer
// boundary. They belong in React renders and route handlers, never in another
// service handler, so this gate rejects those too.
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type FunctionNode =
  | ts.ArrowFunction
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.MethodDeclaration;

interface Finding {
  file: string;
  line: number;
  message: string;
}

function sourcePaths(directory: string): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) paths.push(...sourcePaths(path));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) paths.push(path);
  }
  return paths;
}

function functionNode(node: ts.Node | undefined): node is FunctionNode {
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

function auditSource(file: string, text: string): Finding[] {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const localFunctions = new Map<string, FunctionNode>();
  const requestReads = new Set<string>();
  const handlers: FunctionNode[] = [];

  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      localFunctions.set(statement.name.text, statement);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && functionNode(declaration.initializer)) {
          localFunctions.set(declaration.name.text, declaration.initializer);
        }
      }
    }
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      /(?:^|\/)read$/.test(statement.moduleSpecifier.text)
    ) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) requestReads.add(element.name.text);
      }
    }
  }

  function collectHandlers(node: ts.Node): void {
    const definition = ts.isCallExpression(node) ? node.arguments[0] : undefined;
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
          functionNode(member.initializer)
        ) {
          handlers.push(member.initializer);
        } else if (ts.isMethodDeclaration(member) && propertyName(member.name) === "handler") {
          handlers.push(member);
        }
      }
    }
    ts.forEachChild(node, collectHandlers);
  }
  collectHandlers(source);

  const findings: Finding[] = [];
  const visited = new Set<string>();

  function add(node: ts.Node, message: string): void {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    findings.push({
      file,
      line: line + 1,
      message,
    });
  }

  function inspect(fn: FunctionNode, contexts: Set<string>): void {
    const key = `${fn.pos}:${[...contexts].sort().join(",")}`;
    if (visited.has(key)) return;
    visited.add(key);

    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node)) {
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "call"
        ) {
          const receiver = node.expression.expression;
          if (!(ts.isIdentifier(receiver) && contexts.has(receiver.text))) {
            add(
              node,
              "direct .call() is reachable from a service handler; compose through its ServiceContext",
            );
          }
        }

        if (ts.isIdentifier(node.expression) && requestReads.has(node.expression.text)) {
          add(
            node,
            `${node.expression.text}() is a request-bound service read; use ctx.call() in a handler`,
          );
        }

        if (ts.isIdentifier(node.expression)) {
          const called = localFunctions.get(node.expression.text);
          if (called) {
            const passedContexts = new Set<string>();
            node.arguments.forEach((argument, index) => {
              if (!ts.isIdentifier(argument) || !contexts.has(argument.text)) return;
              const parameter = called.parameters[index]?.name;
              if (parameter && ts.isIdentifier(parameter)) passedContexts.add(parameter.text);
            });
            inspect(called, passedContexts);
          }
        }
      }
      ts.forEachChild(node, visit);
    }

    if (fn.body) visit(fn.body);
  }

  for (const handler of handlers) {
    const context = handler.parameters[1]?.name;
    inspect(handler, new Set(context && ts.isIdentifier(context) ? [context.text] : []));
  }
  return findings;
}

function auditFile(path: string): Finding[] {
  return auditSource(
    relative(process.cwd(), path).replaceAll("\\", "/"),
    readFileSync(path, "utf8"),
  );
}

describe("service composition source boundary", () => {
  it("detects direct and helper-hidden service calls", () => {
    const findings = auditSource(
      "fixture.ts",
      `
        const hidden = () => child.call({}, { kind: "system" });
        export const parent = defineService({
          handler: async (_input, ctx) => {
            await child.call({}, ctx.actor);
            await hidden();
          },
        });
      `,
    );
    expect(findings).toHaveLength(2);
    expect(findings.every((finding) => finding.message.includes("direct .call()"))).toBe(true);
  });

  it("detects request-cached reads reached through a helper", () => {
    const findings = auditSource(
      "fixture.ts",
      `
        import { currentBusiness as business } from "@/core/settings/read";
        async function hidden() { return business(); }
        export const parent = defineService({
          handler: async (_input, ctx) => hidden(),
        });
      `,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("business() is a request-bound service read");
  });

  it("permits ambient composition and outer-boundary service calls", () => {
    expect(
      auditSource(
        "fixture.ts",
        `
          const outside = () => child.call({}, { kind: "system" });
          async function nested(ctx) { return ctx.call(child, {}); }
          export const parent = defineService({
            handler: async (_input, context) => {
              await context.call(child, {});
              await context.callAsSystem(child, {});
              return nested(context);
            },
          });
        `,
      ),
    ).toEqual([]);
  });

  it("keeps every nested service call in the caller transaction", () => {
    const findings = sourcePaths(resolve(process.cwd(), "src"))
      .flatMap(auditFile)
      .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    expect(
      findings,
      findings.map((finding) => `${finding.file}:${finding.line} ${finding.message}`).join("\n"),
    ).toEqual([]);
  });
});
