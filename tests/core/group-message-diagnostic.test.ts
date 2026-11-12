// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { diagnosticErrors, diagnosticPath, diagnosticText } from "../browser/group-message-diagnostic";

it("retains message paths without query values and omits other routes", () => {
  expect(diagnosticPath("https://example.test/messages?to=sam,kim&claim=private")).toBe("/messages");
  expect(diagnosticPath("https://example.test/admin/claim/private")).toBe("[other route]");
  expect(diagnosticPath("not a URL")).toBe("[unavailable]");
});

it("omits credential-bearing console and typed-error messages", () => {
  for (const value of ["Authorization: Bearer synthetic", "private key data", "cookie=value", "secret=value", "csrf=value", "claim link"]) {
    expect(diagnosticText(value)).toBe("[sensitive diagnostic omitted]");
  }
  expect(diagnosticText("Fetch failed https://example.test/messages?private=value")).toBe("Fetch failed /messages");
  expect(diagnosticText("x".repeat(64))).toBe("[opaque]");
  expect(diagnosticText("short ".repeat(100)).length).toBe(300);
});

it("extracts only explicit typed errors, never surrounding response contents", () => {
  expect(diagnosticErrors({ ok: { ciphertext: "private body", key: "private material" }, nested: {
    error: { code: "conflict", message: "Try again", secret: "private material", stack: "private stack" },
  } })).toEqual([{ code: "conflict", message: "Try again" }]);
  expect(diagnosticErrors({ error: { code: "conflict", message: "credential=private" } })).toEqual([
    { code: "conflict", message: "[sensitive diagnostic omitted]" },
  ]);
  expect(diagnosticErrors({ error: { code: "not a typed code", message: "private body" } })).toEqual([]);
});
