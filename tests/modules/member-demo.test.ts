// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.16: the demo community loads with the creator and everything scenarios,
// shows in the member feed and market, and purges without a trace.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { like } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { ready } from "@/core/runtime";
import { loadDemoScenario, purgeDemoScenario } from "@/core/demo/service";
import { latestPublic } from "@/modules/members/posts";
import { viewConversation, listConversations } from "@/modules/members/messages";
import { marketListings } from "@/modules/catalog/market";
import { memberProfiles } from "@/modules/members/schema";
import { ANONYMOUS, closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("demo community (C12.16)", () => {
  beforeAll(async () => { await ready(); }, 60_000);
  beforeEach(truncateSpine);
  afterAll(closeDb);

  it("loads a small community and purges it exactly", async () => {
    const loaded = await loadDemoScenario.call({ key: "seed.everything", locale: "fr" }, OWNER);
    expect(loaded.action).toBe("loaded");
    const posts = (await latestPublic.call({}, ANONYMOUS)).posts.map((p) => p.body);
    expect(posts).toEqual(expect.arrayContaining(["[Demo] Lumière du matin sur le port aujourd’hui. #photographie"]));
    expect(posts.some((b) => b.includes("fanzine"))).toBe(false);
    expect((await marketListings.call({}, ANONYMOUS)).map((l) => l.name)).toEqual(["[Demo] Préréglages photo du port"]);

    const [ben] = await db().select().from(memberProfiles).where(like(memberProfiles.handle, "demo_ben"));
    const as = { kind: "user" as const, userId: ben!.userId, role: "customer", grants: [] };
    const [conversation] = await listConversations.call({}, as);
    expect((await viewConversation.call({ id: conversation!.id }, as)).messages.map((m) => m.body)).toHaveLength(2);

    await purgeDemoScenario.call({}, OWNER);
    expect(await db().select().from(memberProfiles)).toEqual([]);
    expect(await db().select().from(users).where(like(users.email, "%@demo.freeholder.test"))).toEqual([]);
    expect(await marketListings.call({}, ANONYMOUS)).toEqual([]);
  });
});
