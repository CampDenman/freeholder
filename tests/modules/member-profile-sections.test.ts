// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.20: a member's avatar and portfolio are their own uploaded images, and
// each profile section shows only to the audience it was set for.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { ready } from "@/core/runtime";
import { uploadAsset } from "@/core/media/service";
import { joinSite, updateMyMembership } from "@/modules/members/service";
import { followMember, viewProfile } from "@/modules/members/graph";
import { createPost } from "@/modules/members/posts";
import { deleteProfileSection, profileSections, saveProfileSection, setAvatar } from "@/modules/members/profile";
import { ANONYMOUS, closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const RAE = CUSTOMER;
const SAM = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c2" };

async function image(actor: typeof RAE) {
  const bytes = new Uint8Array(await sharp({ create: { width: 600, height: 600, channels: 3, background: { r: 40, g: 90, b: 140 } } }).png().toBuffer());
  return uploadAsset.call({ filename: "me.png", contentType: "image/png", bytes }, actor);
}

describe.runIf(hasDatabase)("member avatars and profile sections (C12.20)", () => {
  beforeAll(async () => { await ready(); }, 60_000);
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values([
      { id: OWNER.userId, email: "owner@example.test", role: "owner" },
      { id: RAE.userId, email: "rae@example.test", role: "customer" },
      { id: SAM.userId, email: "sam@example.test", role: "customer" },
    ]);
    await joinSite.call({ handle: "rae", displayName: "Rae", meetsMinimumAge: true, isAdult: true }, RAE);
    await joinSite.call({ handle: "sam", displayName: "Sam", meetsMinimumAge: true, isAdult: true }, SAM);
  });
  afterAll(closeDb);

  it("sets an avatar only from the member's own uploaded image", async () => {
    const mine = await image(RAE);
    const theirs = await image(SAM);
    expect((await failure(setAvatar.call({ assetId: theirs.id }, RAE))).code).toBe("validation");
    const { avatarUrl } = await setAvatar.call({ assetId: mine.id }, RAE);
    expect(avatarUrl).toBeTruthy();
    expect((await viewProfile.call({ handle: "rae" }, ANONYMOUS)).avatarUrl).toBe(avatarUrl);
    await setAvatar.call({ assetId: null }, RAE);
    expect((await viewProfile.call({ handle: "rae" }, ANONYMOUS)).avatarUrl).toBeNull();
  });

  it("shows each section to its own audience and never widens a pinned post", async () => {
    const shot = await image(RAE);
    const open = await createPost.call({ body: "Open post", visibility: "public" }, RAE);
    const close = await createPost.call({ body: "Followers post", visibility: "followers" }, RAE);
    const other = await createPost.call({ body: "Sam's post", visibility: "public" }, SAM);
    expect((await failure(saveProfileSection.call({ kind: "pinned", title: "Pinned", items: [other.id] }, RAE))).code).toBe("validation");
    await saveProfileSection.call({ kind: "portfolio", title: "Work", items: [shot.id], position: 0 }, RAE);
    await saveProfileSection.call({ kind: "pinned", title: "Pinned", items: [open.id, close.id], position: 1 }, RAE);
    const services = await saveProfileSection.call({ kind: "services", title: "Rates", body: "Portraits from $150", visibility: "followers", position: 2 }, RAE);

    const anon = await profileSections.call({ handle: "rae" }, ANONYMOUS);
    expect(anon.map((s) => s.title)).toEqual(["Work", "Pinned"]);
    expect(anon[0]!.images).toHaveLength(1);
    expect(anon[1]!.posts.map((p) => p.body)).toEqual(["Open post"]);

    await updateMyMembership.call({ isPrivate: false }, RAE);
    await followMember.call({ handle: "rae" }, SAM);
    const follower = await profileSections.call({ handle: "rae" }, SAM);
    expect(follower.map((s) => s.title)).toEqual(["Work", "Pinned", "Rates"]);
    expect(follower[1]!.posts.map((p) => p.body)).toEqual(["Open post", "Followers post"]);

    expect((await failure(deleteProfileSection.call({ id: services.id }, SAM))).code).toBe("not_found");
    await deleteProfileSection.call({ id: services.id }, RAE);
    expect((await profileSections.call({ handle: "rae" }, SAM)).map((s) => s.title)).toEqual(["Work", "Pinned"]);
  });
});
