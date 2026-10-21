// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A size check after Request.text()/json()/arrayBuffer()/formData() is too late:
// the untrusted allocation already happened. Keep server routes on the shared
// streaming reader, including reading multipart bytes before parsing them.
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function routePaths(directory: string): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) paths.push(...routePaths(path));
    else if (entry.name === "route.ts") paths.push(path);
  }
  return paths;
}

function issues(text: string): string[] {
  const found: string[] = [];
  if (/\b(?:request|req)\.(?:text|json|arrayBuffer)\s*\(/.test(text)) {
    found.push("direct unbounded body read");
  }
  if (
    /\b(?:request|req)\.formData\s*\(/.test(text) &&
    !text.includes("readBoundedFormData(")
  ) {
    found.push("multipart parse without a declared byte bound");
  }
  return found;
}

describe("HTTP request-body boundaries", () => {
  it("detects unbounded text and multipart fixtures", () => {
    expect(issues("await request.text()")).toEqual(["direct unbounded body read"]);
    expect(issues("await request.formData()")).toEqual([
      "multipart parse without a declared byte bound",
    ]);
    expect(issues("await readBoundedFormData(request, 10)")).toEqual([]);
  });

  it("keeps every App Router endpoint bounded before allocation", () => {
    const findings = routePaths(resolve(process.cwd(), "app")).flatMap((path) =>
      issues(readFileSync(path, "utf8")).map((message) =>
        `${relative(process.cwd(), path).replaceAll("\\", "/")}: ${message}`,
      ),
    );
    expect(findings, findings.join("\n")).toEqual([]);
  });

  it("keeps registry API, MCP and provider callbacks on streaming readers", () => {
    const paths = [
      "src/core/api/dispatch.ts",
      "src/core/http/route.ts",
      "src/mcp/server.ts",
      "src/core/messaging/webhook-route.ts",
      "src/modules/invoicing/payment-webhook-route.ts",
    ];
    const findings = paths.flatMap((path) =>
      issues(source(path)).map((message) => `${path}: ${message}`),
    );
    expect(findings, findings.join("\n")).toEqual([]);
  });
});

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}
