// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// The HTTP API and its contract (MASTER.md §11, §28).
//
// §28's claim is strong enough to be worth testing directly: "it is
// definitionally impossible for the spec to describe a shape the API doesn't
// enforce". So the tests here are less about individual endpoints than about
// that equivalence — every service has an endpoint, every endpoint has a spec
// entry, and the spec's schema is the validator, not a copy of it.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { coerceQuery, dispatch } from "@/core/api/dispatch";
import { buildOpenApi } from "@/core/api/openapi";
import { listServices } from "@/core/service";
import { ready } from "@/core/runtime";
import { createApiKey } from "@/core/apikeys/service";
import { users } from "@/core/auth/schema";
import { db } from "@/core/db";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const BASE = "http://localhost/api/v1";

function get(name: string, query = "", headers: Record<string, string> = {}) {
  return dispatch(
    new Request(`${BASE}/${name}${query}`, { headers }),
    name,
  );
}

function post(
  name: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return dispatch(
    new Request(`${BASE}/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    name,
  );
}

describe("reading a query string into a schema", () => {
  const parse = (search: string) =>
    coerceQuery(new URL(`http://x/y?${search}`));

  it("keeps ordinary words as strings", () => {
    expect(parse("name=Ann&city=Courtenay")).toEqual({
      name: "Ann",
      city: "Courtenay",
    });
  });

  it("reads the literals a schema actually expects", () => {
    // Without this every GET with a boolean or numeric field fails validation
    // before it reaches the service.
    expect(parse("includeHidden=true&limit=25&after=null")).toEqual({
      includeHidden: true,
      limit: 25,
      after: null,
    });
  });

  it("reads arrays and objects", () => {
    expect(parse('tags=["a","b"]&seo={"title":"x"}')).toEqual({
      tags: ["a", "b"],
      seo: { title: "x" },
    });
  });

  it("leaves something that merely starts like a number alone", () => {
    // "210 Fifth Street" begins with a digit and is not JSON.
    expect(parse("street=210 Fifth Street")).toEqual({
      street: "210 Fifth Street",
    });
  });
});

describe.runIf(hasDatabase)("calling a service over HTTP", () => {
  beforeEach(async () => {
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("answers a public query with no credential at all", async () => {
    const response = await get("settings.getBusiness");
    expect(response.status).toBe(200);
  });

  it("refuses an unknown service the way it refuses an unknown URL", async () => {
    // To a caller these are the same mistake, and answering differently would
    // tell somebody probing which half of the name they got right.
    const response = await get("contacts.doesNotExist");
    expect(response.status).toBe(404);
  });

  it("refuses to change data through a GET", async () => {
    // A mutation reachable by GET is one a prefetch, a crawler or an <img> tag
    // can fire. No downstream CSRF check helps if the request never looked
    // unsafe.
    const response = await get("contacts.create", "?name=Ann");
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("POST");
  });

  it("still refuses that GET even for a key that holds the scope", async () => {
    const key = await createApiKey.call(
      { name: "Writer", scopes: ["contacts.*"] },
      OWNER,
    );
    const response = await get("contacts.create", "?name=Ann", {
      authorization: `Bearer ${key.token}`,
    });
    expect(response.status).toBe(400);
  });

  it("carries out a mutation for a key that holds the scope", async () => {
    const key = await createApiKey.call(
      { name: "Writer", scopes: ["contacts.*"] },
      OWNER,
    );
    const response = await post(
      "contacts.create",
      { name: "Ann Example", email: "ann@example.test" },
      { authorization: `Bearer ${key.token}` },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { name: string };
    expect(body.name).toBe("Ann Example");
  });

  it("refuses the same call for a key without the scope", async () => {
    const key = await createApiKey.call(
      { name: "Reader", scopes: ["cms.*"] },
      OWNER,
    );
    const response = await post(
      "contacts.create",
      { name: "Ann Example" },
      { authorization: `Bearer ${key.token}` },
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { message: string } };
    // Written for the developer holding the key, not for a business owner.
    expect(body.error.message).toContain("contacts.create");
  });

  it("answers 401 rather than 403 when nothing was presented", async () => {
    const response = await post("contacts.create", { name: "Ann" });
    expect(response.status).toBe(401);
  });

  it("validates with the service's own schema", async () => {
    const key = await createApiKey.call(
      { name: "Writer", scopes: ["contacts.*"] },
      OWNER,
    );
    const response = await post(
      "contacts.create",
      { email: "not-an-email" },
      { authorization: `Bearer ${key.token}` },
    );
    expect(response.status).toBe(400);
  });

  it("needs no CSRF token, because a bearer call cannot be forged", async () => {
    // The proof is the test above passing: it sends no x-csrf-token and no
    // cookie, and a mutation went through. Stated here so that a future change
    // making CSRF unconditional fails with an explanation rather than a
    // mystery.
    const key = await createApiKey.call(
      { name: "Writer", scopes: ["contacts.*"] },
      OWNER,
    );
    const response = await post(
      "contacts.create",
      { name: "No CSRF Needed" },
      { authorization: `Bearer ${key.token}` },
    );
    expect(response.status).toBe(200);
  });
});

describe.runIf(hasDatabase)("the published contract", () => {
  const spec = async () => {
    await ready();
    return buildOpenApi({
      origin: "https://example.test",
      version: "0.1.0",
      title: "Aurora Coast",
    }) as {
      paths: Record<string, Record<string, { requestBody?: unknown; tags: string[] }>>;
      tags: { name: string }[];
      info: { version: string };
    };
  };

  it("describes every service the instance has, and nothing else", async () => {
    // The equivalence §28 rests on. A service added tomorrow is in the spec
    // tomorrow because there is no list to update.
    const document = await spec();
    const described = Object.keys(document.paths).sort();
    const registered = [...listServices().keys()]
      .map((name) => `/api/v1/${name}`)
      .sort();
    expect(described).toEqual(registered);
  });

  it("uses the schema that validates, not a copy of it", async () => {
    // The whole claim: the request body in the document is generated from
    // `service.def.input`, so it cannot describe a shape the API would reject.
    const document = await spec();
    const service = listServices().get("contacts.create")!;
    const fromRegistry = z.toJSONSchema(service.def.input, { io: "input" }) as Record<
      string,
      unknown
    >;
    delete fromRegistry.$schema;

    const operation = document.paths["/api/v1/contacts.create"]!.post!;
    const body = operation.requestBody as {
      content: { "application/json": { schema: unknown } };
    };
    expect(body.content["application/json"].schema).toEqual(fromRegistry);
  });

  it("describes the input shape rather than the output shape", async () => {
    // A field with a default is optional going in and present coming out.
    // Describing the output would document defaults as required fields.
    const document = await spec();
    const operation = document.paths["/api/v1/locations.list"]!.get!;
    const parameter = (operation as unknown as { parameters: { schema: { required?: string[] } }[] })
      .parameters[0]!;
    expect(parameter.schema.required ?? []).not.toContain("includeHidden");
  });

  it("gives queries a GET and mutations only a POST", async () => {
    const document = await spec();
    expect(Object.keys(document.paths["/api/v1/contacts.list"]!).sort()).toEqual([
      "get",
      "post",
    ]);
    expect(Object.keys(document.paths["/api/v1/contacts.create"]!)).toEqual(["post"]);
  });

  it("can be generated for every service without throwing", async () => {
    // A schema JSON Schema cannot express would otherwise take the document
    // down at request time, on an instance nobody has tested this on.
    const document = await spec();
    expect(Object.keys(document.paths).length).toBeGreaterThan(50);
    for (const [path, operations] of Object.entries(document.paths)) {
      const operation = operations.post ?? operations.get!;
      expect({ path, tagged: operation.tags.length }).toEqual({ path, tagged: 1 });
    }
  });

  it("names the scope a caller needs, in the description", async () => {
    // Somebody reading this is deciding what to ask their owner to grant.
    const document = await spec();
    const operation = document.paths["/api/v1/contacts.create"]!.post! as unknown as {
      description: string;
    };
    expect(operation.description).toContain("contacts.create");
    expect(operation.description).toContain("contacts.*");
  });
});
