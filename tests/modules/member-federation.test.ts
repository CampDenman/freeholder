// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.18: a member who federates can be found and followed from another
// server, receives only signed activities, and has their public posts
// delivered, signed, to remote followers. A local HTTP server plays the
// remote server.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { ready } from "@/core/runtime";
import { joinSite, updateMembershipRules } from "@/modules/members/service";
import { createPost, deletePost } from "@/modules/members/posts";
import { deliverFederation, federationDocument, setMyFederation } from "@/modules/members/federation/core";
import { followRemote, moveToRemote, remoteFeed, remoteFollows, setFediverseAliases, unfollowRemote } from "@/modules/members/federation/following";
import { newActorKeys, signRequest, verifyRequest } from "@/modules/members/federation/signatures";
import { memberFederationDeliveries, memberRemoteFollowers } from "@/modules/members/schema";
import { POST as inbox } from "../../app/ap/users/[handle]/inbox/route";
import { GET as webfinger } from "../../app/.well-known/webfinger/route";
import { ANONYMOUS, closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const RAE = CUSTOMER;
const remoteKeys = newActorKeys();
let remote: Server;
let base = "";
const received: { path: string; headers: Record<string, string>; body: string }[] = [];

/** Who the remote accounts say are also them (C12.33). */
const aliases: Record<string, string[]> = { sam: [], sam2: [] };

function remoteActor(name = "sam") {
  return {
    "@context": ["https://www.w3.org/ns/activitystreams"],
    id: `${base}/users/${name}`,
    type: "Person",
    preferredUsername: name,
    inbox: `${base}/users/${name}/inbox`,
    endpoints: { sharedInbox: `${base}/inbox` },
    alsoKnownAs: aliases[name] ?? [],
    publicKey: { id: `${base}/users/${name}#main-key`, owner: `${base}/users/${name}`, publicKeyPem: remoteKeys.publicKeyPem },
  };
}

async function sendToInbox(activity: Record<string, unknown>, sign = true) {
  const url = "http://localhost:3000/ap/users/rae/inbox";
  const body = JSON.stringify(activity);
  const headers: Record<string, string> = sign
    ? signRequest({ method: "POST", url, body, keyId: `${base}/users/sam#main-key`, privateKeyPem: remoteKeys.privateKeyPem, extra: { "content-type": "application/activity+json" } })
    : { "content-type": "application/activity+json" };
  return inbox(new Request(url, { method: "POST", headers, body }), { params: Promise.resolve({ handle: "rae" }) });
}

describe("http signatures (C12.18)", () => {
  it("verifies what it signs and refuses tampering, staleness and missing digests", async () => {
    const keys = newActorKeys();
    const url = "https://site.test/ap/users/rae/inbox";
    const body = '{"type":"Follow"}';
    const headers = signRequest({ method: "POST", url, body, keyId: "k", privateKeyPem: keys.privateKeyPem });
    const verify = (h: Record<string, string>, b = body, now?: Date) => verifyRequest({ method: "POST", path: "/ap/users/rae/inbox", headers: h, body: b, publicKeyFor: async () => keys.publicKeyPem, now });
    await expect(verify(headers)).resolves.toBe("k");
    await expect(verify(headers, '{"type":"Undo"}')).rejects.toThrow(/digest/);
    await expect(verify(headers, body, new Date(Date.now() + 13 * 3600_000))).rejects.toThrow(/date/);
    await expect(verify({ ...headers, host: "evil.test" })).rejects.toThrow(/verify/);
  });
});

describe("remote HTML to text (C12.32)", () => {
  it("leaves no markup even when tags are split around each other", async () => {
    const { plainText } = await import("@/modules/members/federation/following");
    expect(plainText("<scr<script>x</script>ipt>alert(1)</script>")).not.toMatch(/<|>?script/i);
    expect(plainText("<<b>i</b>mg src=x onerror=alert(1)>")).not.toContain("<");
    expect(plainText("<p>1 &lt; 2 &amp;&amp; 3 &gt; 2</p>")).toBe("1 < 2 && 3 > 2");
  });
});

describe.runIf(hasDatabase)("ActivityPub federation (C12.18)", () => {
  beforeAll(async () => {
    await ready();
    remote = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => { body += c.toString(); });
      req.on("end", () => {
        if (req.method === "GET" && req.url?.startsWith("/.well-known/webfinger")) {
          const name = /acct%3A([a-z0-9]+)%40/.exec(req.url)?.[1] ?? "sam";
          res.writeHead(200, { "content-type": "application/jrd+json" });
          res.end(JSON.stringify({ subject: `acct:${name}@remote`, links: [{ rel: "self", type: "application/activity+json", href: `${base}/users/${name}` }] }));
          return;
        }
        const actorMatch = req.method === "GET" ? /^\/users\/(sam2?)$/.exec(req.url ?? "") : null;
        if (actorMatch) {
          res.writeHead(200, { "content-type": "application/activity+json" });
          res.end(JSON.stringify(remoteActor(actorMatch[1])));
          return;
        }
        received.push({ path: req.url ?? "", headers: req.headers as Record<string, string>, body });
        res.writeHead(202);
        res.end();
      });
    });
    await new Promise<void>((resolve) => remote.listen(0, "127.0.0.1", resolve));
    const address = remote.address();
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  }, 60_000);
  beforeEach(async () => {
    received.length = 0;
    aliases.sam = [];
    aliases.sam2 = [];
    await truncateSpine();
    await db().insert(users).values([
      { id: OWNER.userId, email: "owner@example.test", role: "owner" },
      { id: RAE.userId, email: "rae@example.test", role: "customer" },
    ]);
    await joinSite.call({ handle: "rae", displayName: "Rae", meetsMinimumAge: true, isAdult: true }, RAE);
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => remote.close(() => resolve()));
    await closeDb();
  });

  it("stays invisible until both the site and the member opt in", async () => {
    expect((await failure(setMyFederation.call({ federated: true }, RAE))).code).toBe("validation");
    expect(await federationDocument.call({ kind: "actor", handle: "rae" }, ANONYMOUS)).toBeNull();
    await updateMembershipRules.call({ federation: true }, OWNER);
    expect(await federationDocument.call({ kind: "actor", handle: "rae" }, ANONYMOUS)).toBeNull();
    const { address } = await setMyFederation.call({ federated: true }, RAE);
    expect(address).toBe("@rae@localhost:3000");
    const actor = await federationDocument.call({ kind: "actor", handle: "rae" }, ANONYMOUS);
    expect(actor).toMatchObject({ type: "Person", preferredUsername: "rae", inbox: "http://localhost:3000/ap/users/rae/inbox" });
    expect((actor as { publicKey: { publicKeyPem: string } }).publicKey.publicKeyPem).toMatch(/BEGIN PUBLIC KEY/);
    const jrd = await webfinger(new Request("http://localhost:3000/.well-known/webfinger?resource=acct:rae@localhost:3000"));
    expect(((await jrd.json()) as { links: { rel: string; href: string }[] }).links.find((l) => l.rel === "self")?.href).toBe("http://localhost:3000/ap/users/rae");
  });

  it("accepts only signed follows, delivers public posts signed, and leaves cleanly", async () => {
    await updateMembershipRules.call({ federation: true }, OWNER);
    await setMyFederation.call({ federated: true }, RAE);
    const follow = { "@context": "https://www.w3.org/ns/activitystreams", id: `${base}/follows/1`, type: "Follow", actor: `${base}/users/sam`, object: "http://localhost:3000/ap/users/rae" };
    expect((await sendToInbox({ ...follow, padding: "x".repeat(300 * 1024) })).status).toBe(413);
    expect((await sendToInbox(follow, false)).status).toBe(401);
    expect((await sendToInbox({ ...follow, actor: `${base}/users/mallory` })).status).toBe(401);
    expect((await sendToInbox(follow)).status).toBe(202);
    expect(await db().select({ handle: memberRemoteFollowers.handle }).from(memberRemoteFollowers)).toEqual([{ handle: `sam@127.0.0.1:${new URL(base).port}` }]);

    const open = await createPost.call({ body: "Hello fediverse", visibility: "public" }, RAE);
    await createPost.call({ body: "Followers only", visibility: "followers" }, RAE);
    await deliverFederation();
    const types = received.map((r) => (JSON.parse(r.body) as { type: string }).type);
    expect(types).toEqual(["Accept", "Create"]);
    const create = received[1]!;
    expect(create.path).toBe("/inbox");
    expect((JSON.parse(create.body) as { object: { content: string } }).object.content).toBe("<p>Hello fediverse</p>");
    const actor = (await federationDocument.call({ kind: "actor", handle: "rae" }, ANONYMOUS)) as { publicKey: { publicKeyPem: string } };
    await expect(verifyRequest({ method: "POST", path: create.path, headers: create.headers, body: create.body, publicKeyFor: async () => actor.publicKey.publicKeyPem })).resolves.toBe("http://localhost:3000/ap/users/rae#main-key");

    await deletePost.call({ id: open.id }, RAE);
    await deliverFederation();
    expect(received.map((r) => (JSON.parse(r.body) as { type: string }).type).at(-1)).toBe("Delete");
    expect(await federationDocument.call({ kind: "note", id: open.id }, ANONYMOUS)).toBeNull();

    expect((await sendToInbox({ type: "Undo", id: `${base}/undo/1`, actor: `${base}/users/sam`, object: follow })).status).toBe(202);
    expect(await db().select().from(memberRemoteFollowers)).toEqual([]);
    await sendToInbox(follow);
    await setMyFederation.call({ federated: false }, RAE);
    expect(await db().select().from(memberRemoteFollowers)).toEqual([]);
    const pending = await db().select().from(memberFederationDeliveries).where(eq(memberFederationDeliveries.userId, RAE.userId));
    expect(pending.some((d) => (d.activity as { type: string }).type === "Delete" && (d.activity as { object: unknown }).object === "http://localhost:3000/ap/users/rae")).toBe(true);
  });

  it("follows an account elsewhere, takes its public posts as plain text, and honours Update, Delete and Block (C12.32)", async () => {
    await updateMembershipRules.call({ federation: true }, OWNER);
    await setMyFederation.call({ federated: true }, RAE);
    const address = `@sam@${new URL(base).host}`;
    expect((await followRemote.call({ address }, RAE)).handle).toBe(`sam@${new URL(base).host}`);
    await deliverFederation();
    const follow = JSON.parse(received.find((r) => (JSON.parse(r.body) as { type: string }).type === "Follow")!.body) as { id: string; actor: string; object: string };
    expect(follow).toMatchObject({ actor: "http://localhost:3000/ap/users/rae", object: `${base}/users/sam` });
    expect((await remoteFollows.call({}, RAE)).follows.map((f) => f.state)).toEqual(["pending"]);

    const note = (id: string, content: string, to = ["https://www.w3.org/ns/activitystreams#Public"]) => ({ id: `${base}/notes/${id}`, type: "Note", attributedTo: `${base}/users/sam`, to, content, published: "2026-10-15T10:00:00Z", url: `${base}/@sam/${id}` });
    const create = (id: string, content: string, to?: string[]) => ({ id: `${base}/notes/${id}/activity`, type: "Create", actor: `${base}/users/sam`, object: note(id, content, to) });
    // Before Sam's server accepts, nothing is taken.
    expect((await sendToInbox(create("0", "<p>too early</p>"))).status).toBe(202);
    expect((await sendToInbox({ id: `${base}/accepts/1`, type: "Accept", actor: `${base}/users/sam`, object: follow.id })).status).toBe(202);
    expect((await remoteFollows.call({}, RAE)).follows.map((f) => f.state)).toEqual(["accepted"]);

    await sendToInbox(create("1", "<p>Hello <b>from</b> elsewhere<br>second line</p><script>alert(1)</script>"));
    await sendToInbox(create("2", "<p>Only for my followers</p>", [`${base}/users/sam/followers`]));
    let feed = (await remoteFeed.call({}, RAE)).posts;
    expect(feed.map((p) => p.text)).toEqual(["Hello from elsewhere\nsecond line"]);
    await sendToInbox({ id: `${base}/notes/1/update`, type: "Update", actor: `${base}/users/sam`, object: note("1", "<p>Edited</p>") });
    expect((await remoteFeed.call({}, RAE)).posts.map((p) => p.text)).toEqual(["Edited"]);
    await sendToInbox({ id: `${base}/notes/1/delete`, type: "Delete", actor: `${base}/users/sam`, object: { id: `${base}/notes/1`, type: "Tombstone" } });
    expect((await remoteFeed.call({}, RAE)).posts).toEqual([]);

    // A Block from the account ends the follow, and its posts leave the feed.
    await sendToInbox(create("3", "<p>Again</p>"));
    feed = (await remoteFeed.call({}, RAE)).posts;
    expect(feed).toHaveLength(1);
    await sendToInbox({ id: `${base}/blocks/1`, type: "Block", actor: `${base}/users/sam`, object: "http://localhost:3000/ap/users/rae" });
    expect((await remoteFollows.call({}, RAE)).follows).toEqual([]);
    expect((await remoteFeed.call({}, RAE)).posts).toEqual([]);

    // Unfollowing sends Undo.
    await followRemote.call({ address }, RAE);
    received.length = 0;
    await unfollowRemote.call({ actorUri: `${base}/users/sam` }, RAE);
    await deliverFederation();
    expect(received.map((r) => (JSON.parse(r.body) as { type: string }).type)).toContain("Undo");
  });

  it("names accounts elsewhere, moves followers out only to an account that names it back, and follows a move in (C12.33)", async () => {
    await updateMembershipRules.call({ federation: true }, OWNER);
    await setMyFederation.call({ federated: true }, RAE);
    const host = new URL(base).host;
    const raeActor = "http://localhost:3000/ap/users/rae";

    // Aliases resolve to actors and appear on Rae's actor document.
    expect((await setFediverseAliases.call({ addresses: [`@sam@${host}`] }, RAE)).aliases).toEqual([`${base}/users/sam`]);
    expect(await federationDocument.call({ kind: "actor", handle: "rae" }, ANONYMOUS)).toMatchObject({ alsoKnownAs: [`${base}/users/sam`] });

    // Moving out: refused until the new account names Rae, then announced to followers.
    const follow = { "@context": "https://www.w3.org/ns/activitystreams", id: `${base}/follows/1`, type: "Follow", actor: `${base}/users/sam`, object: raeActor };
    await sendToInbox(follow);
    expect((await failure(moveToRemote.call({ address: `@sam2@${host}` }, RAE))).code).toBe("validation");
    aliases.sam2 = [raeActor];
    expect(await moveToRemote.call({ address: `@sam2@${host}` }, RAE)).toEqual({ notified: 1, target: `${base}/users/sam2` });
    await deliverFederation();
    const move = received.map((r) => JSON.parse(r.body) as { type: string; target?: string }).find((a) => a.type === "Move");
    expect(move).toMatchObject({ type: "Move", target: `${base}/users/sam2` });
    expect(await federationDocument.call({ kind: "actor", handle: "rae" }, ANONYMOUS)).toMatchObject({ movedTo: `${base}/users/sam2` });

    // Moving in: Rae follows sam, sam moves to sam2 (which names sam back), and Rae now follows sam2.
    await followRemote.call({ address: `@sam@${host}` }, RAE);
    await deliverFederation();
    const sent = received.map((r) => JSON.parse(r.body) as { type: string; id: string }).filter((a) => a.type === "Follow").at(-1)!;
    await sendToInbox({ id: `${base}/accepts/9`, type: "Accept", actor: `${base}/users/sam`, object: sent.id });
    const bogus = { id: `${base}/moves/0`, type: "Move", actor: `${base}/users/sam`, object: `${base}/users/sam`, target: `${base}/users/sam2` };
    aliases.sam2 = [];
    await sendToInbox(bogus);
    expect((await remoteFollows.call({}, RAE)).follows.map((f) => f.actorUri)).toEqual([`${base}/users/sam`]);
    aliases.sam2 = [`${base}/users/sam`];
    received.length = 0;
    await sendToInbox({ ...bogus, id: `${base}/moves/1` });
    expect((await remoteFollows.call({}, RAE)).follows.map((f) => [f.actorUri, f.state])).toEqual([[`${base}/users/sam2`, "pending"]]);
    await deliverFederation();
    expect(received.map((r) => `${(JSON.parse(r.body) as { type: string }).type} ${r.path}`).sort()).toEqual(["Follow /users/sam2/inbox", "Undo /users/sam/inbox"]);
  });
});
