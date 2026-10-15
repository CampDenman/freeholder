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

function remoteActor() {
  return {
    "@context": ["https://www.w3.org/ns/activitystreams"],
    id: `${base}/users/sam`,
    type: "Person",
    preferredUsername: "sam",
    inbox: `${base}/users/sam/inbox`,
    endpoints: { sharedInbox: `${base}/inbox` },
    publicKey: { id: `${base}/users/sam#main-key`, owner: `${base}/users/sam`, publicKeyPem: remoteKeys.publicKeyPem },
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

describe.runIf(hasDatabase)("ActivityPub federation (C12.18)", () => {
  beforeAll(async () => {
    await ready();
    remote = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => { body += c.toString(); });
      req.on("end", () => {
        if (req.method === "GET" && req.url === "/users/sam") {
          res.writeHead(200, { "content-type": "application/activity+json" });
          res.end(JSON.stringify(remoteActor()));
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
});
