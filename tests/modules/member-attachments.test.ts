// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.21: attached files are the member's own processed uploads, private once
// attached, and readable only by people who can see what they are attached to.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { ready } from "@/core/runtime";
import { assets } from "@/core/media/schema";
import { authorizeObjectDelivery, uploadAsset } from "@/core/media/service";
import { joinSite, updateMyMembership } from "@/modules/members/service";
import { followMember } from "@/modules/members/graph";
import { commentOnPost, createPost, deletePost, viewPost } from "@/modules/members/posts";
import { sendMessage, startConversation, unsendMessage, viewConversation } from "@/modules/members/messages";
import { fileAccess } from "@/modules/members/attachments";
import { ANONYMOUS, closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const RAE = CUSTOMER;
const SAM = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c2" };
const KIM = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c3" };

async function photo(actor: typeof RAE) {
  const bytes = new Uint8Array(await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 20, g: 120, b: 90 } } }).jpeg().toBuffer());
  return uploadAsset.call({ filename: "harbour.jpg", contentType: "image/jpeg", bytes }, actor);
}

describe.runIf(hasDatabase)("member attachments (C12.21)", () => {
  beforeAll(async () => { await ready(); }, 60_000);
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values([
      { id: OWNER.userId, email: "owner@example.test", role: "owner" },
      { id: RAE.userId, email: "rae@example.test", role: "customer" },
      { id: SAM.userId, email: "sam@example.test", role: "customer" },
      { id: KIM.userId, email: "kim@example.test", role: "customer" },
    ]);
    for (const [actor, handle] of [[RAE, "rae"], [SAM, "sam"], [KIM, "kim"]] as const) {
      await joinSite.call({ handle, displayName: handle, meetsMinimumAge: true, isAdult: true }, actor);
    }
    await updateMyMembership.call({ isPrivate: false }, RAE);
  });
  afterAll(closeDb);

  it("applies the post's audience to its files and revokes them with the post", async () => {
    const shot = await photo(RAE);
    const post = await createPost.call({ visibility: "followers", attachments: [{ assetId: shot.id, altText: "Boats at dawn" }] }, RAE);
    expect(post.attachments.map((a) => [a.kind, a.altText])).toEqual([["image", "Boats at dawn"]]);
    const fileId = post.attachments[0]!.id;
    const [stored] = await db().select().from(assets).where(eq(assets.id, shot.id));
    expect(stored!.isPrivate).toBe(true);
    expect(await authorizeObjectDelivery.call({ key: stored!.storageKey }, ANONYMOUS)).toBeNull();

    expect(await fileAccess.call({ id: fileId }, ANONYMOUS)).toBeNull();
    expect(await fileAccess.call({ id: fileId }, SAM)).toBeNull();
    await followMember.call({ handle: "rae" }, SAM);
    expect((await fileAccess.call({ id: fileId }, SAM))?.key).toBe(stored!.storageKey);
    expect((await fileAccess.call({ id: fileId, width: 320 }, SAM))?.contentType).toBe("image/webp");
    await deletePost.call({ id: post.id }, RAE);
    expect(await fileAccess.call({ id: fileId }, SAM)).toBeNull();
  });

  it("only attaches the member's own unattached uploads", async () => {
    const theirs = await photo(SAM);
    expect((await failure(createPost.call({ visibility: "public", attachments: [{ assetId: theirs.id, altText: "" }] }, RAE))).code).toBe("validation");
    const mine = await photo(RAE);
    await createPost.call({ visibility: "public", attachments: [{ assetId: mine.id, altText: "" }] }, RAE);
    expect((await failure(createPost.call({ body: "Again", visibility: "public", attachments: [{ assetId: mine.id, altText: "" }] }, RAE))).code).toBe("conflict");
    expect((await failure(createPost.call({ visibility: "public" }, RAE))).code).toBe("validation");
  });

  it("keeps message files inside the conversation and comment files with their comment", async () => {
    const { id: conversationId } = await startConversation.call({ handles: ["sam"], body: "Hi Sam" }, RAE);
    await followMember.call({ handle: "rae" }, SAM);
    const shot = await photo(RAE);
    const { id: messageId } = await sendMessage.call({ conversationId, body: "Look", attachments: [{ assetId: shot.id, altText: "Proof print" }] }, RAE);
    const [message] = (await viewConversation.call({ id: conversationId }, SAM)).messages.filter((m) => m.id === messageId);
    const fileId = message!.attachments[0]!.id;
    expect(await fileAccess.call({ id: fileId }, SAM)).not.toBeNull();
    expect(await fileAccess.call({ id: fileId }, KIM)).toBeNull();
    await unsendMessage.call({ id: messageId }, RAE);
    expect(await fileAccess.call({ id: fileId }, SAM)).toBeNull();

    const post = await createPost.call({ body: "Open thread", visibility: "public" }, RAE);
    const reply = await photo(SAM);
    await commentOnPost.call({ postId: post.id, body: "Mine too", attachments: [{ assetId: reply.id, altText: "Sam's print" }] }, SAM);
    const [comment] = (await viewPost.call({ id: post.id }, KIM)).comments;
    expect(comment!.attachments.map((a) => a.altText)).toEqual(["Sam's print"]);
    expect(await fileAccess.call({ id: comment!.attachments[0]!.id }, ANONYMOUS)).not.toBeNull();
  });
});
