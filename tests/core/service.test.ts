// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// The service wrapper's guarantees that need no database. Anything that gets
// past the permission and validation gates opens a transaction, so the
// behaviour of a *successful* call is tested in spine.test.ts instead; what
// lives here is the part that must reject before touching anything.
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  actorString,
  defineService,
  getService,
  listServices,
  permits,
  redact,
  registerService,
  resetRegistryForTests,
  ServiceError,
  type Actor,
} from "@/core/service";
import { failure } from "../helpers/spine";

const user = (role: "owner" | "staff" | "customer"): Actor => ({
  kind: "user",
  userId: "u1",
  role,
});
const agent = (scopes: string[]): Actor => ({
  kind: "agent",
  keyName: "claude",
  scopes,
});
const SYSTEM: Actor = { kind: "system" };
const ANON: Actor = { kind: "anonymous" };

describe("permits() — the authorization matrix", () => {
  it("ranks roles, so owner ⊇ staff ⊇ customer", () => {
    expect(permits(user("owner"), "staff", "x.y")).toBe(true);
    expect(permits(user("staff"), "staff", "x.y")).toBe(true);
    expect(permits(user("customer"), "staff", "x.y")).toBe(false);
    expect(permits(user("staff"), "owner", "x.y")).toBe(false);
    expect(permits(user("customer"), "owner", "x.y")).toBe(false);
    expect(permits(user("customer"), "customer", "x.y")).toBe(true);
  });

  it("lets system through anything — it is the platform itself", () => {
    expect(permits(SYSTEM, "owner", "x.y")).toBe(true);
    expect(permits(SYSTEM, "public", "x.y")).toBe(true);
  });

  it("admits anonymous callers only to public services", () => {
    expect(permits(ANON, "public", "x.y")).toBe(true);
    expect(permits(ANON, "customer", "x.y")).toBe(false);
    expect(permits(ANON, "staff", "x.y")).toBe(false);
    expect(permits(ANON, "owner", "x.y")).toBe(false);
  });

  it("grants an agent an exact service name", () => {
    expect(permits(agent(["contacts.create"]), "staff", "contacts.create")).toBe(
      true,
    );
    expect(permits(agent(["contacts.create"]), "staff", "contacts.merge")).toBe(
      false,
    );
  });

  it("grants an agent a module wildcard", () => {
    expect(permits(agent(["contacts.*"]), "staff", "contacts.merge")).toBe(true);
    expect(permits(agent(["contacts.*"]), "owner", "contacts.merge")).toBe(true);
    expect(permits(agent(["contacts.*"]), "staff", "auth.login")).toBe(false);
  });

  it("does not let a wildcard for one module reach another", () => {
    expect(permits(agent(["auth.*"]), "staff", "contacts.create")).toBe(false);
    // Nor a prefix that merely looks similar.
    expect(permits(agent(["contact.*"]), "staff", "contacts.create")).toBe(
      false,
    );
  });

  it("refuses a scopeless agent everything that isn't public", () => {
    expect(permits(agent([]), "customer", "contacts.get")).toBe(false);
    expect(permits(agent([]), "owner", "contacts.merge")).toBe(false);
  });

  it("ignores role rank for agents — scopes are the only currency", () => {
    // An agent has no role, so a broad scope is required even for a
    // customer-level service.
    expect(permits(agent(["other.*"]), "customer", "contacts.get")).toBe(false);
  });
});

describe("rejection happens before the handler", () => {
  let runs = 0;
  const probe = defineService({
    name: "probe.run",
    summary: "Records whether it was reached.",
    kind: "mutation",
    permission: "staff",
    input: z.object({ n: z.number().int() }),
    handler: async () => {
      runs += 1;
      return { ok: true };
    },
  });

  beforeEach(() => {
    runs = 0;
  });

  it("refuses an under-privileged caller without running anything", async () => {
    const error = await failure(probe
      .call({ n: 1 }, user("customer")));
    expect(error).toBeInstanceOf(ServiceError);
    expect(error.code).toBe("permission");
    expect(error.message).toContain("user:u1");
    expect(error.message).toContain("probe.run");
    expect(runs).toBe(0);
  });

  it("rejects invalid input without running the handler", async () => {
    const error = await failure(probe
      .call({ n: "not a number" }, user("owner")));
    expect(error.code).toBe("validation");
    expect(error.message).toContain("n:");
    expect(runs).toBe(0);
  });

  it("checks permission before validation, so schemas never leak", async () => {
    // Someone who may not call this must not learn its input shape from the
    // error they get back.
    const error = await failure(probe
      .call({ garbage: true }, user("customer")));
    expect(error.code).toBe("permission");
    expect(runs).toBe(0);
  });
});

describe("redact()", () => {
  it("removes secrets at any depth, by key name", () => {
    expect(
      redact({
        email: "a@b.test",
        password: "hunter2",
        nested: { apiKey: "sk-live", otpSecret: "ABC", token: "t" },
        list: [{ passwordHash: "x" }, { name: "fine" }],
      }),
    ).toEqual({
      email: "a@b.test",
      password: "[redacted]",
      nested: {
        apiKey: "[redacted]",
        otpSecret: "[redacted]",
        token: "[redacted]",
      },
      list: [{ passwordHash: "[redacted]" }, { name: "fine" }],
    });
  });

  it("leaves primitives and nulls alone", () => {
    expect(redact("plain")).toBe("plain");
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
  });
});

describe("actorString()", () => {
  it("renders every actor kind for the audit trail", () => {
    expect(actorString(user("owner"))).toBe("user:u1");
    expect(actorString(agent(["*"]))).toBe("agent:claude");
    expect(actorString(SYSTEM)).toBe("system");
    expect(actorString(ANON)).toBe("anonymous");
  });
});

describe("the registry", () => {
  const one = defineService({
    name: "registry.one",
    summary: "x",
    kind: "query",
    permission: "public",
    input: z.object({}),
    handler: async () => null,
  });

  beforeEach(() => {
    resetRegistryForTests();
  });

  it("registers and resolves by name", () => {
    registerService(one);
    expect(getService("registry.one")).toBe(one);
    expect(listServices().size).toBe(1);
  });

  it("refuses a duplicate name", () => {
    registerService(one);
    expect(() => registerService(one)).toThrow(/registered twice/);
  });

  it("fails loudly for an unknown name", () => {
    expect(() => getService("nope.missing")).toThrow(ServiceError);
  });
});
