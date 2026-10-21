// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C0.09: target language must never masquerade as current availability.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checklistItems } from "../../scripts/plan-gate.mjs";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function manifest(path: string): { description?: string } {
  return JSON.parse(read(path)) as { description?: string };
}

const master = read("MASTER.md");
const open = new Set(
  checklistItems(master)
    .filter((item) => !item.checked)
    .map((item) => item.id),
);

describe("docs availability (C0.09)", () => {
  it("keeps README status distinct from the product-complete target", () => {
    const readme = read("README.md");
    expect(readme).toMatch(/not a release candidate/i);
    expect(readme).toMatch(/## Product-complete target/);
    expect(readme).toMatch(
      /not a claim that every item below is\s+already implemented/i,
    );
    expect(readme).toMatch(/MASTER\.md.*§43/);
  });

  it("does not present unfinished updater, mobile or auto-billing as shipped", () => {
    const current = [
      read("README.md").split("## Product-complete target")[0] ?? "",
      read("deploy/README.md"),
      read("CONTRIBUTING.md"),
      read("packages/README.md"),
    ].join("\n");
    if (open.has("C10.01") || open.has("C10.12")) {
      expect(current).not.toMatch(/\bself-update(?:r|s|ing)?\b is (live|shipped|available)/i);
      expect(current).not.toMatch(/\bmobile app\b is (live|shipped|available|in the stores)/i);
    }
    if (open.has("C9.33")) {
      expect(current).not.toMatch(/automatic subscription billing is (live|shipped|available)/i);
    }
  });

  it("keeps package descriptions aligned with open C3 package work", () => {
    const packages = read("packages/README.md");
    const sdk = `${manifest("packages/sdk/package.json").description}\n${read("packages/sdk/README.md")}`;
    const create = `${manifest("packages/create-freeholder/package.json").description}\n${read("packages/create-freeholder/README.md")}`;
    const templates = `${manifest("packages/templates/package.json").description}\n${read("packages/templates/README.md")}`;

    if (open.has("C3.03")) {
      expect(packages).toMatch(/C3\.03/);
      expect(sdk).toMatch(/C3\.03|generic/i);
    }
    if (open.has("C3.14")) {
      expect(packages).toMatch(/C3\.14/);
      expect(create).toMatch(/C3\.14/);
    }
    if (open.has("C3.15")) {
      expect(packages).toMatch(/C3\.15/);
      expect(templates).toMatch(/starter|pre-release/i);
    }
    if (open.has("C3.20")) {
      expect(packages).toMatch(/C3\.20/);
    }
  });

  it("does not present SemVer image tags as currently published while C3.20 is open", () => {
    const deploy = read("deploy/README.md");
    if (open.has("C3.20")) {
      expect(deploy).toMatch(/edge/);
      expect(deploy).toMatch(/C3\.20|when a release is tagged|no versioned release/i);
    }
  });

  it("keeps the root package description from reading as a finished release", () => {
    const description = manifest("package.json").description ?? "";
    expect(description).toMatch(/not a release candidate|in (active )?development/i);
  });

  it("does not tell a first-run owner that unfinished surfaces already work", () => {
    const setup = Object.entries(JSON.parse(read("locales/en.json")) as Record<string, string>)
      .filter(([key]) => key.startsWith("setup."))
      .map(([, value]) => value)
      .join("\n");
    expect(setup).not.toMatch(/self-update|mobile app|app store|automatic billing/i);
    expect(setup).not.toMatch(/auto-publish|auto-authorize/i);
  });
});
