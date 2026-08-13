// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { defineModule, sortModules } from "@/core/module";

const mod = (name: string, requires?: string[]) =>
  defineModule({ name, version: "1.0.0", requires });

const order = (names: string[]) => names.join(",");

describe("sortModules()", () => {
  it("boots a module after everything it requires", () => {
    const sorted = sortModules([
      mod("quotes", ["invoicing"]),
      mod("invoicing", ["payments"]),
      mod("payments"),
    ]);
    expect(order(sorted.map((m) => m.name))).toBe("payments,invoicing,quotes");
  });

  it("keeps independent modules and includes every one exactly once", () => {
    const sorted = sortModules([
      mod("cms"),
      mod("galleries", ["cms"]),
      mod("booking"),
      mod("quotes", ["invoicing"]),
      mod("invoicing"),
    ]);
    expect(sorted).toHaveLength(5);
    expect(new Set(sorted.map((m) => m.name)).size).toBe(5);
    const names = sorted.map((m) => m.name);
    expect(names.indexOf("cms")).toBeLessThan(names.indexOf("galleries"));
    expect(names.indexOf("invoicing")).toBeLessThan(names.indexOf("quotes"));
  });

  it("names the cycle rather than hanging", () => {
    expect(() =>
      sortModules([mod("a", ["b"]), mod("b", ["c"]), mod("c", ["a"])]),
    ).toThrow(/circular module dependency: a → b → c → a/);
  });

  it("catches a module requiring itself", () => {
    expect(() => sortModules([mod("a", ["a"])])).toThrow(
      /circular module dependency/,
    );
  });

  it("reports a missing dependency in plain English", () => {
    expect(() => sortModules([mod("quotes", ["invoicing"])])).toThrow(
      /module "quotes" requires "invoicing", which is not installed/,
    );
  });

  it("is stable for an already-sorted list", () => {
    const input = [mod("a"), mod("b", ["a"]), mod("c", ["b"])];
    expect(order(sortModules(input).map((m) => m.name))).toBe(
      order(input.map((m) => m.name)),
    );
  });
});
