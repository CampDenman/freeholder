// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Drizzle wraps driver errors, so a unique-violation check that only inspects
// the caught error matches nothing — and a never-matching check looks exactly
// like a missing constraint. These tests pin the unwrapping.
import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "@/core/db";

const driverError = (constraint: string) =>
  Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint_name: constraint,
  });

const wrapped = (cause: unknown) =>
  Object.assign(new Error("Failed query"), { cause });

describe("isUniqueViolation()", () => {
  it("sees through the wrapper drizzle actually throws", () => {
    expect(isUniqueViolation(wrapped(driverError("contacts_email_idx")))).toBe(
      true,
    );
  });

  it("matches an unwrapped driver error too", () => {
    expect(isUniqueViolation(driverError("users_email_idx"))).toBe(true);
  });

  it("distinguishes constraints, so one conflict is not read as another", () => {
    const error = wrapped(driverError("users_email_idx"));
    expect(isUniqueViolation(error, "users_email_idx")).toBe(true);
    expect(isUniqueViolation(error, "users_single_owner_idx")).toBe(false);
  });

  it("ignores every other failure", () => {
    expect(isUniqueViolation(new Error("network went away"))).toBe(false);
    expect(
      isUniqueViolation(
        wrapped(Object.assign(new Error("fk"), { code: "23503" })),
      ),
    ).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("a string")).toBe(false);
  });

  it("terminates on a self-referential cause chain", () => {
    const loop: { cause?: unknown } = {};
    loop.cause = loop;
    expect(isUniqueViolation(loop)).toBe(false);
  });
});
