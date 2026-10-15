// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.14: a person's own key acts as them, only for the services it names,
// never for staff or system services, never to mint more keys, and expires.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { ready } from "@/core/runtime";
import { actorFromRequest } from "@/core/http/actor";
import { createMyKey, myKeys, revokeMyKey } from "@/core/apikeys/personal";
import { joinSite } from "@/modules/members/service";
import { createPost, homeFeed, viewPost } from "@/modules/members/posts";
import { listReports } from "@/modules/members/reports";
import { saveSetupBusiness } from "@/core/settings/service";
import { toolsFor } from "@/mcp/tools";
import { closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const RAE = CUSTOMER;

async function as(token: string) {
  return actorFromRequest(new Request("https://site.test/api", { headers: { authorization: `Bearer ${token}` } }));
}

describe.runIf(hasDatabase)("personal keys (C12.14)", () => {
  beforeAll(async () => { await ready(); }, 60_000);
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values([
      { id: OWNER.userId, email: "owner@example.test", role: "owner" },
      { id: RAE.userId, email: "rae@example.test", role: "customer" },
    ]);
    await joinSite.call({ handle: "rae", displayName: "Rae", meetsMinimumAge: true, isAdult: true }, RAE);
    await joinSite.call({ handle: "own", displayName: "Owner", meetsMinimumAge: true, isAdult: true }, OWNER);
  });
  afterAll(closeDb);

  it("acts as the member, only for what the key names", async () => {
    expect((await failure(createMyKey.call({ name: "Agent", scopes: ["members.reports"] }, RAE))).code).toBe("validation");
    expect((await failure(createMyKey.call({ name: "Agent", scopes: ["nope.nothing"] }, RAE))).code).toBe("validation");
    expect((await failure(createMyKey.call({ name: "Agent", scopes: ["members.post"], expiresInDays: 365 }, RAE))).code).toBe("validation");
    const key = await createMyKey.call({ name: "My agent", scopes: ["members.post", "members.feed"] }, RAE);
    expect(key.name).toBe("My agent");

    const agent = await as(key.token);
    expect(agent).toMatchObject({ kind: "user", userId: RAE.userId, keyScopes: ["members.post", "members.feed"] });
    const post = await createPost.call({ body: "Posted by my agent", visibility: "followers" }, agent);
    expect(post.author.handle).toBe("rae");
    expect((await homeFeed.call({}, agent)).posts.map((p) => p.body)).toEqual(["Posted by my agent"]);
    expect((await failure(viewPost.call({ id: post.id }, agent))).code).toBe("permission");
    expect((await failure(createMyKey.call({ name: "Another", scopes: ["members.post"] }, agent))).code).toBe("permission");
    expect((await myKeys.call({}, RAE)).map((k) => k.name)).toEqual(["My agent"]);

    await revokeMyKey.call({ id: key.id }, RAE);
    expect((await as(key.token)).kind).toBe("anonymous");
  });

  it("never carries a staff member's admin access", async () => {
    const key = await createMyKey.call({ name: "Owner's agent", scopes: ["members.*"] }, OWNER);
    const agent = await as(key.token);
    expect(agent.kind).toBe("user");
    expect((await failure(listReports.call({}, agent))).code).toBe("permission");
    expect((await listReports.call({}, OWNER))).toEqual([]);
    expect((await failure(revokeMyKey.call({ id: key.id }, RAE))).code).toBe("not_found");
  });

  it("cannot take a human-review action, and lists only its own tools over MCP", async () => {
    const key = await createMyKey.call({ name: "Setup agent", scopes: ["settings.saveSetupBusiness", "members.post"] }, RAE);
    const agent = await as(key.token);
    const refused = await failure(saveSetupBusiness.call({}, agent));
    expect([refused.code, refused.message]).toEqual(["permission", "Sign in as a person to perform this human-review action."]);
    expect(toolsFor(agent).map((t) => t.name).sort()).toEqual(["members_post"]);
  });
});
