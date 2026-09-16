// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Client proofing (MASTER.md §4.5, C8.05).
//
// The rules:
//
//   1. A client marks a frame from their session — no second login.
//   2. Changing your mind updates the mark; it does not add a second one.
//   3. A guest sees their own marks, never the client's.
//   4. Proofing follows the view ceiling: an unviewable frame takes no opinion.
//   5. A session with no contact behind it cannot proof.
//   6. The owner sees everyone's marks together.
//   7. Merge keeps one opinion per person per frame; the survivor's wins.
//   8. Erasure keeps the choice and drops the chooser.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { assets } from "@/core/media/schema";
import { createContact, mergeContacts } from "@/core/contacts/service";
import { updateBusiness } from "@/core/settings/service";
import {
  addGalleryItem,
  clearGallerySelection,
  createGallery,
  inviteGalleryGuest,
  listGallerySelections,
  redeemGalleryGuest,
  setGallerySelection,
  unlockGallery,
  updateGalleryItem,
  viewGallerySession,
} from "@/modules/galleries/service";
import { gallerySelections } from "@/modules/galleries/schema";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe.runIf(hasDatabase)("gallery proofing", { timeout: 90_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await updateBusiness.call(
      {
        name: "Hearth & Pine",
        country: "CA",
        baseCurrency: "CAD",
        timezone: "America/Vancouver",
      },
      OWNER,
    );
  }, 60_000);
  afterAll(closeDb);

  async function image(filename: string) {
    const [created] = await db()
      .insert(assets)
      .values({
        kind: "image",
        storageKey: `test/${crypto.randomUUID()}.jpg`,
        filename,
        mime: "image/jpeg",
        legacyBytes: 1024,
        bytes: 1024,
        status: "ready",
      })
      .returning();
    return created!;
  }

  function opened<T extends { ok: boolean }>(
    result: T,
  ): asserts result is T & { ok: true; sessionToken: string; items: { id: string }[] } {
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the gallery to open");
  }

  async function proofableGallery(title = "Proofs") {
    const client = await createContact.call(
      { name: "Rae Lane", email: "client@example.test" },
      OWNER,
    );
    const gallery = await createGallery.call(
      { contactId: client.id, title, access: "pin", secret: "2468" },
      OWNER,
    );
    return { client, gallery };
  }

  it("records a mark from the session, and changing your mind replaces it", async () => {
    const { client, gallery } = await proofableGallery();
    const file = await image("one.jpg");
    const item = await addGalleryItem.call(
      { galleryId: gallery.id, assetId: file.id },
      OWNER,
    );
    const session = await unlockGallery.call(
      { slug: gallery.slug, secret: "2468" },
      ANONYMOUS,
    );
    opened(session);

    const first = await setGallerySelection.call(
      { sessionToken: session.sessionToken, itemId: item.id, kind: "favorite" },
      ANONYMOUS,
    );
    expect(first).toMatchObject({ kind: "favorite", contactId: client.id, assetId: file.id });

    const second = await setGallerySelection.call(
      {
        sessionToken: session.sessionToken,
        itemId: item.id,
        kind: "reject",
        comment: "Blinked.",
      },
      ANONYMOUS,
    );
    // The owner must never have to reconcile two answers from one person about
    // one frame, so this is an update rather than a second row.
    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({ kind: "reject", comment: "Blinked." });

    const rows = await db()
      .select()
      .from(gallerySelections)
      .where(eq(gallerySelections.galleryId, gallery.id));
    expect(rows).toHaveLength(1);
  });

  it("shows a person their own marks when they come back", async () => {
    const { gallery } = await proofableGallery();
    const file = await image("two.jpg");
    const item = await addGalleryItem.call(
      { galleryId: gallery.id, assetId: file.id },
      OWNER,
    );
    const session = await unlockGallery.call(
      { slug: gallery.slug, secret: "2468" },
      ANONYMOUS,
    );
    opened(session);
    expect(session.selections).toEqual([]);

    await setGallerySelection.call(
      { sessionToken: session.sessionToken, itemId: item.id, kind: "select" },
      ANONYMOUS,
    );
    const again = await viewGallerySession.call(
      { sessionToken: session.sessionToken },
      ANONYMOUS,
    );
    expect(again.ok).toBe(true);
    if (!again.ok) throw new Error("expected the session to read");
    expect(again.selections.map((s) => s.kind)).toEqual(["select"]);
  });

  it("keeps a guest's marks separate from the client's", async () => {
    const { gallery } = await proofableGallery();
    const file = await image("three.jpg");
    const item = await addGalleryItem.call(
      { galleryId: gallery.id, assetId: file.id },
      OWNER,
    );
    const clientSession = await unlockGallery.call(
      { slug: gallery.slug, secret: "2468" },
      ANONYMOUS,
    );
    opened(clientSession);
    await setGallerySelection.call(
      { sessionToken: clientSession.sessionToken, itemId: item.id, kind: "favorite" },
      ANONYMOUS,
    );

    const guest = await inviteGalleryGuest.call(
      { galleryId: gallery.id, email: "partner@example.test", role: "partner" },
      OWNER,
    );
    const guestSession = await redeemGalleryGuest.call({ token: guest.token }, ANONYMOUS);
    opened(guestSession);
    // Neither should be nudged by the other's opinion before giving one.
    expect(guestSession.selections).toEqual([]);

    await setGallerySelection.call(
      { sessionToken: guestSession.sessionToken, itemId: item.id, kind: "reject" },
      ANONYMOUS,
    );
    const owner = await listGallerySelections.call({ galleryId: gallery.id }, OWNER);
    expect(owner).toHaveLength(2);
    expect(owner.map((s) => s.kind).sort()).toEqual(["favorite", "reject"]);
  });

  it("refuses an opinion about a frame the person cannot see", async () => {
    const { gallery } = await proofableGallery();
    const hidden = await image("hidden.jpg");
    const item = await addGalleryItem.call(
      { galleryId: gallery.id, assetId: hidden.id },
      OWNER,
    );
    await updateGalleryItem.call({ id: item.id, canView: false }, OWNER);
    const session = await unlockGallery.call(
      { slug: gallery.slug, secret: "2468" },
      ANONYMOUS,
    );
    opened(session);
    expect(
      (
        await failure(
          setGallerySelection.call(
            { sessionToken: session.sessionToken, itemId: item.id, kind: "favorite" },
            ANONYMOUS,
          ),
        )
      ).message,
    ).toContain("not in this gallery");
  });

  it("takes a mark back without leaving a fourth opinion behind", async () => {
    const { gallery } = await proofableGallery();
    const file = await image("four.jpg");
    const item = await addGalleryItem.call(
      { galleryId: gallery.id, assetId: file.id },
      OWNER,
    );
    const session = await unlockGallery.call(
      { slug: gallery.slug, secret: "2468" },
      ANONYMOUS,
    );
    opened(session);
    await setGallerySelection.call(
      { sessionToken: session.sessionToken, itemId: item.id, kind: "select" },
      ANONYMOUS,
    );
    await clearGallerySelection.call(
      { sessionToken: session.sessionToken, itemId: item.id },
      ANONYMOUS,
    );
    expect(await listGallerySelections.call({ galleryId: gallery.id }, OWNER)).toEqual([]);
  });

  it("merges two people into one opinion per frame, keeping the survivor's", async () => {
    const keep = await createContact.call(
      { name: "Rae Keep", email: "keep@example.test" },
      OWNER,
    );
    const drop = await createContact.call(
      { name: "Rae Drop", email: "drop@example.test" },
      OWNER,
    );
    const gallery = await createGallery.call(
      { contactId: keep.id, title: "Merge proofs", access: "pin", secret: "2468" },
      OWNER,
    );
    const file = await image("five.jpg");
    await addGalleryItem.call({ galleryId: gallery.id, assetId: file.id }, OWNER);

    await db().insert(gallerySelections).values([
      { galleryId: gallery.id, contactId: keep.id, assetId: file.id, kind: "favorite" },
      { galleryId: gallery.id, contactId: drop.id, assetId: file.id, kind: "reject" },
    ]);

    await mergeContacts.call({ survivingId: keep.id, duplicateId: drop.id }, OWNER);

    const rows = await db()
      .select()
      .from(gallerySelections)
      .where(eq(gallerySelections.galleryId, gallery.id));
    // The unique index allows exactly one, and inventing a merge of "favorite"
    // and "reject" would put words in their mouth.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ contactId: keep.id, kind: "favorite" });
  });

  it("erasure keeps the choice and drops the chooser", async () => {
    const { client, gallery } = await proofableGallery();
    const file = await image("six.jpg");
    const item = await addGalleryItem.call(
      { galleryId: gallery.id, assetId: file.id },
      OWNER,
    );
    const session = await unlockGallery.call(
      { slug: gallery.slug, secret: "2468" },
      ANONYMOUS,
    );
    opened(session);
    await setGallerySelection.call(
      { sessionToken: session.sessionToken, itemId: item.id, kind: "select" },
      ANONYMOUS,
    );

    const { contactPrivacySources } = await import("@/core/privacy/service");
    for (const source of contactPrivacySources().filter(
      (entry) => entry.scope === "contact.galleries",
    )) {
      await db().transaction((tx) => source.erase(tx, client.id, { requestId: "erase-test" }));
    }

    const rows = await db()
      .select()
      .from(gallerySelections)
      .where(eq(gallerySelections.galleryId, gallery.id));
    // The owner still knows which frame was chosen for delivery, and no longer
    // knows whose taste that was.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ contactId: null, kind: "select" });
  });
});
