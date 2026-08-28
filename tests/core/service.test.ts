// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The service wrapper's guarantees that need no database. Anything that gets
// past the permission and validation gates opens a transaction, so the
// behaviour of a *successful* call is tested in spine.test.ts instead; what
// lives here is the part that must reject before touching anything.
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  actorString,
  defineService,
  getExternalService,
  getService,
  listExternalServices,
  listServices,
  permits,
  redact,
  registerService,
  resetRegistryForTests,
  ServiceError,
  type Actor,
} from "@/core/service";
import { failure } from "../helpers/spine";

const user = (
  role: string,
  grants: Array<{ module: string; access: "view" | "manage" }> = [],
): Actor => ({
  kind: "user",
  userId: "u1",
  role,
  grants,
});
const agent = (scopes: string[]): Actor => ({
  kind: "agent",
  keyName: "claude",
  scopes,
});
const SYSTEM: Actor = { kind: "system" };
const ANON: Actor = { kind: "anonymous" };

describe("permits() — the authorization matrix", () => {
  it("gives role names no authority of their own", () => {
    expect(permits(user("owner"), "scoped", "contacts.list", "query")).toBe(
      false,
    );
    expect(
      permits(user("made-up-superuser"), "scoped", "contacts.list", "query"),
    ).toBe(false);
  });

  it("lets view grants read but requires manage grants to mutate", () => {
    const viewer = user("editor", [{ module: "cms", access: "view" }]);
    const manager = user("editor", [{ module: "cms", access: "manage" }]);
    expect(permits(viewer, "scoped", "cms.listPages", "query")).toBe(true);
    expect(permits(viewer, "scoped", "cms.updatePage", "mutation")).toBe(false);
    expect(permits(manager, "scoped", "cms.listPages", "query")).toBe(true);
    expect(permits(manager, "scoped", "cms.updatePage", "mutation")).toBe(true);
  });

  it("supports a stored all-module grant without naming the owner role", () => {
    const full = user("anything", [{ module: "*", access: "manage" }]);
    expect(permits(full, "scoped", "contacts.merge", "mutation")).toBe(true);
    expect(permits(full, "scoped", "cms.listPages", "query")).toBe(true);
  });

  it("uses the strongest applicable grant regardless of database row order", () => {
    const wildcardLast = user("custom", [
      { module: "contacts", access: "view" },
      { module: "*", access: "manage" },
    ]);
    const specificLast = user("custom", [
      { module: "*", access: "view" },
      { module: "contacts", access: "manage" },
    ]);
    expect(permits(wildcardLast, "scoped", "contacts.merge", "mutation")).toBe(
      true,
    );
    expect(permits(specificLast, "scoped", "contacts.merge", "mutation")).toBe(
      true,
    );
  });

  it("admits any signed-in person to personal authenticated services", () => {
    expect(permits(user("customer"), "authenticated", "auth.logout")).toBe(
      true,
    );
  });

  it("lets system through anything — it is the platform itself", () => {
    expect(permits(SYSTEM, "scoped", "x.y")).toBe(true);
    expect(permits(SYSTEM, "public", "x.y")).toBe(true);
    expect(permits(SYSTEM, "system", "x.y")).toBe(true);
  });

  it("reserves system services for the platform even from wildcard keys", () => {
    expect(permits(ANON, "system", "briefing.assemble")).toBe(false);
    expect(
      permits(
        user("owner", [{ module: "*", access: "manage" }]),
        "system",
        "briefing.assemble",
      ),
    ).toBe(false);
    expect(
      permits(agent(["*", "briefing.*"]), "system", "briefing.assemble"),
    ).toBe(false);
  });

  it("admits anonymous callers only to public services", () => {
    expect(permits(ANON, "public", "x.y")).toBe(true);
    expect(permits(ANON, "authenticated", "x.y")).toBe(false);
    expect(permits(ANON, "scoped", "x.y")).toBe(false);
  });

  it("grants an agent an exact service name", () => {
    expect(permits(agent(["contacts.create"]), "scoped", "contacts.create")).toBe(
      true,
    );
    expect(permits(agent(["contacts.create"]), "scoped", "contacts.merge")).toBe(
      false,
    );
  });

  it("grants an agent a module wildcard", () => {
    expect(permits(agent(["contacts.*"]), "scoped", "contacts.merge")).toBe(true);
    expect(permits(agent(["contacts.*"]), "scoped", "auth.login")).toBe(false);
  });

  it("does not let a wildcard for one module reach another", () => {
    expect(permits(agent(["auth.*"]), "scoped", "contacts.create")).toBe(false);
    // Nor a prefix that merely looks similar.
    expect(permits(agent(["contact.*"]), "scoped", "contacts.create")).toBe(
      false,
    );
  });

  it("refuses a scopeless agent everything that isn't public", () => {
    expect(permits(agent([]), "scoped", "contacts.get")).toBe(false);
    expect(permits(agent([]), "scoped", "contacts.merge")).toBe(false);
  });

  it("keeps personal authenticated services away from API keys", () => {
    expect(permits(agent(["auth.*"]), "authenticated", "auth.logout")).toBe(
      false,
    );
  });
});

describe("rejection happens before the handler", () => {
  let runs = 0;
  const probe = defineService({
    name: "probe.run",
    summary: "Records whether it was reached.",
    kind: "mutation",
    permission: "scoped",
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
    expect(runs).toBe(0);

    // The message reaches a business owner's screen, so it must not name the
    // internal service or the actor id. The setup wizard showed them
    // "anonymous may not call settings.updateBusiness." before this changed.
    // Attribution belongs in the audit trail, not the interface.
    expect(error.message).not.toContain("user:u1");
    expect(error.message).not.toContain("probe.run");
    expect(error.message).toMatch(/permission/i);
  });

  it("tells an anonymous caller to sign in, rather than that they lack a role", () => {
    // Two different problems with two different remedies: "sign in" is
    // actionable, "you lack permission" is not when the fix is a login.
    return failure(probe.call({ n: 1 }, ANON)).then((error) => {
      expect(error.code).toBe("permission");
      expect(error.message).toMatch(/sign in/i);
    });
  });

  it("rejects invalid input without running the handler", async () => {
    const error = await failure(
      probe.call(
        { n: "not a number" },
        user("owner", [{ module: "*", access: "manage" }]),
      ),
    );
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
        classificationNote: "May contain visitor details",
        list: [{ passwordHash: "x" }, { name: "fine" }],
      }),
    ).toEqual({
      email: "a@b.test",
      password: "[redacted]",
      classificationNote: "[redacted]",
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
  const internal = defineService({
    name: "registry.internal",
    summary: "Trusted composition only.",
    kind: "mutation",
    permission: "system",
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

  it("keeps system services registered for composition but off external projections", () => {
    registerService(one);
    registerService(internal);
    expect(getService("registry.internal")).toBe(internal);
    expect(listServices().size).toBe(2);
    expect([...listExternalServices().keys()]).toEqual(["registry.one"]);
    let refusal: unknown;
    try {
      getExternalService("registry.internal");
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toMatchObject({ code: "not_found" });
  });

  it("accepts the same service twice, because boot is a precondition", () => {
    // Boot is no longer a one-shot startup step — every module graph boots its
    // own copy on demand (core/runtime.ts), so a graph can legitimately be
    // asked to boot more than once. Re-registering the identical service must
    // therefore be a no-op rather than a crash.
    registerService(one);
    expect(() => registerService(one)).not.toThrow();
    expect(listServices().size).toBe(1);
    expect(getService("registry.one")).toBe(one);
  });

  it("still refuses two different services claiming one name", () => {
    // The collision that matters: two modules both calling themselves
    // "registry.one". Letting the second win would silently route every call
    // to whichever module happened to load last.
    const impostor = defineService({
      name: "registry.one",
      summary: "a different service wearing the same name",
      kind: "query",
      permission: "public",
      input: z.object({}),
      handler: async () => null,
    });
    registerService(one);
    expect(() => registerService(impostor)).toThrow(/registered twice/);
  });

  it("fails loudly for an unknown name", () => {
    expect(() => getService("nope.missing")).toThrow(ServiceError);
  });
});
