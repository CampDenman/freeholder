// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.17: a load test of member feeds and messaging. Off by default (it seeds
// thousands of rows); run with `pnpm test:load` against a disposable database.
//
// It seeds 300 members with ten posts each and a follow graph of fifty per
// member, then measures, under ten-way concurrency: 100 home feeds, 100
// public feeds and 200 message sends across 20 conversations. The budgets are
// p95 latencies a small single-node site should meet comfortably.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { ready } from "@/core/runtime";
import type { Actor } from "@/core/service";
import { memberFollows, memberPosts, memberProfiles } from "@/modules/members/schema";
import { homeFeed, latestPublic } from "@/modules/members/posts";
import { sendMessage, startConversation } from "@/modules/members/messages";
import { closeDb, hasDatabase, truncateSpine } from "../helpers/spine";

const MEMBERS = 300;
const POSTS_EACH = 10;
const FOLLOWS_EACH = 50;
const CONCURRENCY = 10;
const BUDGET_MS = { homeFeed: 400, latestPublic: 300, sendMessage: 250 } as const;

const id = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
const actor = (n: number): Actor => ({ kind: "user", userId: id(n), role: "customer", grants: [] });

async function timed<T>(label: string, jobs: (() => Promise<T>)[]) {
  const durations: number[] = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++]!;
      const started = performance.now();
      await job();
      durations.push(performance.now() - started);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  durations.sort((a, b) => a - b);
  const pick = (q: number) => Math.round(durations[Math.min(durations.length - 1, Math.floor(q * durations.length))]!);
  const result = { label, n: durations.length, p50: pick(0.5), p95: pick(0.95), max: Math.round(durations.at(-1)!) };
  console.log(JSON.stringify(result));
  return result;
}

describe.runIf(hasDatabase && process.env.FREEHOLDER_LOAD === "1")("member feeds and messaging under load (C12.17)", () => {
  beforeAll(async () => {
    await ready();
    await truncateSpine();
    const now = Date.now();
    await db().insert(users).values(Array.from({ length: MEMBERS }, (_, i) => ({ id: id(i), email: `m${i}@load.test`, role: "customer" })));
    await db().insert(memberProfiles).values(
      Array.from({ length: MEMBERS }, (_, i) => ({ userId: id(i), handle: `load_${i}`, displayName: `Member ${i}`, ageAttestedAt: new Date(now), isPrivate: false })),
    );
    const posts = [];
    for (let i = 0; i < MEMBERS; i += 1) {
      for (let p = 0; p < POSTS_EACH; p += 1) {
        posts.push({ authorId: id(i), body: `Post ${p} from member ${i} #load`, visibility: p % 3 === 0 ? ("followers" as const) : ("public" as const), createdAt: new Date(now - (i * POSTS_EACH + p) * 1000) });
      }
    }
    for (let k = 0; k < posts.length; k += 1000) await db().insert(memberPosts).values(posts.slice(k, k + 1000));
    const follows = [];
    for (let i = 0; i < MEMBERS; i += 1) {
      for (let f = 1; f <= FOLLOWS_EACH; f += 1) follows.push({ followerId: id(i), followeeId: id((i + f) % MEMBERS), status: "active" as const });
    }
    for (let k = 0; k < follows.length; k += 1000) await db().insert(memberFollows).values(follows.slice(k, k + 1000));
  }, 300_000);
  afterAll(async () => {
    await truncateSpine();
    await closeDb();
  });

  it("serves home feeds, public feeds and messages within budget", async () => {
    const feeds = await timed("homeFeed", Array.from({ length: 100 }, (_, i) => async () => {
      const page = await homeFeed.call({}, actor(i * 3 % MEMBERS));
      expect(page.posts.length).toBeGreaterThan(0);
    }));
    const latest = await timed("latestPublic", Array.from({ length: 100 }, (_, i) => async () => {
      await latestPublic.call({}, actor(i));
    }));
    // Each conversation is between a member and someone they follow, so it is
    // a conversation rather than a request.
    const conversations: { id: string; from: number }[] = [];
    for (let c = 0; c < 20; c += 1) {
      const from = c * 10;
      const { id: conversationId } = await startConversation.call({ handles: [`load_${(from + 1) % MEMBERS}`], body: "Hello" }, actor(from));
      conversations.push({ id: conversationId, from });
    }
    const sends = await timed("sendMessage", Array.from({ length: 200 }, (_, i) => async () => {
      const c = conversations[i % conversations.length]!;
      await sendMessage.call({ conversationId: c.id, body: `Message ${i}` }, actor(c.from));
    }));
    expect(feeds.p95).toBeLessThan(BUDGET_MS.homeFeed);
    expect(latest.p95).toBeLessThan(BUDGET_MS.latestPublic);
    expect(sends.p95).toBeLessThan(BUDGET_MS.sendMessage);
  }, 600_000);
});
