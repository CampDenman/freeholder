// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Approval rounds over a selection set (MASTER.md §4.5, C8.06).
//
// The rules:
//
//   1. A round opens on the first submit, not when the gallery is created.
//   2. Submitting freezes what was chosen; later edits do not rewrite it.
//   3. The client sees the round's state.
//   4. Approving ends the round; there is nothing left to send.
//   5. Sending it back opens the next round and keeps the last one whole.
//   6. Nothing can be approved or sent back that was never submitted.
//   7. Reading a gallery never creates a round — queries do not write.
//   8. Merge repoints who submitted; erasure drops the name and keeps the work.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { assets } from "@/core/media/schema";
import { createContact, mergeContacts } from "@/core/contacts/service";
import { updateBusiness } from "@/core/settings/service";
import {
  addGalleryItem,
  approveGalleryRound,
  createGallery,
  listGalleryRounds,
  reopenGalleryRound,
  setGallerySelection,
  submitGalleryRound,
  unlockGallery,
  viewGallerySession,
} from "@/modules/galleries/service";
import { galleryRounds } from "@/modules/galleries/schema";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe.runIf(hasDatabase)("gallery approval rounds", { timeout: 90_000 }, () => {
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
  ): asserts result is T & {
    ok: true;
    sessionToken: string;
    round: { state: string; sequence: number } | null;
  } {
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the gallery to open");
  }

  async function proofed(title = "Rounds") {
    const client = await createContact.call(
      { name: "Rae Lane", email: "client@example.test" },
      OWNER,
    );
    const gallery = await createGallery.call(
      { contactId: client.id, title, access: "pin", secret: "2468" },
      OWNER,
    );
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
    return { client, gallery, file, item, session };
  }

  it("opens no round until something is submitted", async () => {
    const { gallery, session } = await proofed();
    // Reading is a query, and a query that inserts is a read with a side
    // effect — here, an anonymous page load creating records.
    expect(session.round).toBeNull();
    expect(
      await db()
        .select()
        .from(galleryRounds)
        .where(eq(galleryRounds.galleryId, gallery.id)),
    ).toEqual([]);

    // Reading again must still not create one.
    const again = await viewGallerySession.call(
      { sessionToken: session.sessionToken },
      ANONYMOUS,
    );
    opened(again);
    expect(again.round).toBeNull();
    expect(
      await db()
        .select()
        .from(galleryRounds)
        .where(eq(galleryRounds.galleryId, gallery.id)),
    ).toEqual([]);
  });

  it("freezes what was chosen, and later edits do not rewrite it", async () => {
    const { gallery, item, session } = await proofed();
    await setGallerySelection.call(
      { sessionToken: session.sessionToken, itemId: item.id, kind: "select", comment: "This one." },
      ANONYMOUS,
    );
    const round = await submitGalleryRound.call(
      { sessionToken: session.sessionToken },
      ANONYMOUS,
    );
    expect(round).toMatchObject({ sequence: 1, state: "submitted" });
    expect(round.snapshot).toEqual([
      { assetId: expect.any(String) as string, kind: "select", comment: "This one." },
    ]);

    // Selections stay editable. The submitted round must not follow.
    await setGallerySelection.call(
      { sessionToken: session.sessionToken, itemId: item.id, kind: "reject" },
      ANONYMOUS,
    );
    const [stored] = await db()
      .select()
      .from(galleryRounds)
      .where(eq(galleryRounds.galleryId, gallery.id));
    expect((stored!.snapshot as { kind: string }[])[0]!.kind).toBe("select");
  });

  it("shows the client where the round stands", async () => {
    const { item, session } = await proofed();
    await setGallerySelection.call(
      { sessionToken: session.sessionToken, itemId: item.id, kind: "favorite" },
      ANONYMOUS,
    );
    await submitGalleryRound.call({ sessionToken: session.sessionToken }, ANONYMOUS);
    const view = await viewGallerySession.call(
      { sessionToken: session.sessionToken },
      ANONYMOUS,
    );
    opened(view);
    expect(view.round).toMatchObject({ sequence: 1, state: "submitted" });
  });

  it("refuses a second submission while one is waiting", async () => {
    const { item, session } = await proofed();
    await setGallerySelection.call(
      { sessionToken: session.sessionToken, itemId: item.id, kind: "select" },
      ANONYMOUS,
    );
    await submitGalleryRound.call({ sessionToken: session.sessionToken }, ANONYMOUS);
    expect(
      (await failure(submitGalleryRound.call({ sessionToken: session.sessionToken }, ANONYMOUS)))
        .message,
    ).toContain("already been sent");
  });

  it("refuses to submit nothing", async () => {
    const { session } = await proofed();
    expect(
      (await failure(submitGalleryRound.call({ sessionToken: session.sessionToken }, ANONYMOUS)))
        .message,
    ).toContain("at least one photograph");
  });

  it("approves the round and leaves nothing to send", async () => {
    const { gallery, item, session } = await proofed();
    await setGallerySelection.call(
      { sessionToken: session.sessionToken, itemId: item.id, kind: "select" },
      ANONYMOUS,
    );
    await submitGalleryRound.call({ sessionToken: session.sessionToken }, ANONYMOUS);
    const approved = await approveGalleryRound.call(
      { galleryId: gallery.id, note: "Lovely, proceeding." },
      OWNER,
    );
    expect(approved).toMatchObject({ state: "approved", note: "Lovely, proceeding." });
    expect(approved.decidedAt).not.toBeNull();
    expect(
      (await failure(approveGalleryRound.call({ galleryId: gallery.id }, OWNER))).message,
    ).toContain("nothing submitted");
  });

  it("sends a round back, opening the next and keeping the last whole", async () => {
    const { gallery, item, session } = await proofed();
    await setGallerySelection.call(
      { sessionToken: session.sessionToken, itemId: item.id, kind: "select", comment: "Maybe." },
      ANONYMOUS,
    );
    await submitGalleryRound.call({ sessionToken: session.sessionToken }, ANONYMOUS);
    const next = await reopenGalleryRound.call(
      { galleryId: gallery.id, note: "Could you look at 14 again?" },
      OWNER,
    );
    expect(next).toMatchObject({ sequence: 2, state: "open" });

    const history = await listGalleryRounds.call({ galleryId: gallery.id }, OWNER);
    expect(history.map((r) => [r.sequence, r.state])).toEqual([
      [2, "open"],
      [1, "reopened"],
    ]);
    // The point of a round rather than a status field: what was asked for, and
    // what was said about it, both survive.
    const first = history.find((r) => r.sequence === 1)!;
    expect(first.note).toBe("Could you look at 14 again?");
    expect(first.snapshot).toEqual([
      { assetId: expect.any(String) as string, kind: "select", comment: "Maybe." },
    ]);
    expect(first.decidedAt).not.toBeNull();

    // And the client can submit again into the new round.
    const resubmitted = await submitGalleryRound.call(
      { sessionToken: session.sessionToken },
      ANONYMOUS,
    );
    expect(resubmitted).toMatchObject({ sequence: 2, state: "submitted" });
  });

  it("refuses to decide a round nobody submitted", async () => {
    const { gallery } = await proofed();
    expect(
      (await failure(reopenGalleryRound.call({ galleryId: gallery.id }, OWNER))).message,
    ).toContain("nothing submitted");
  });

  it("repoints who submitted on merge and drops the name on erasure", async () => {
    const { client, gallery, item, session } = await proofed();
    await setGallerySelection.call(
      { sessionToken: session.sessionToken, itemId: item.id, kind: "select" },
      ANONYMOUS,
    );
    await submitGalleryRound.call({ sessionToken: session.sessionToken }, ANONYMOUS);

    const keep = await createContact.call(
      { name: "Rae Keep", email: "keep@example.test" },
      OWNER,
    );
    await mergeContacts.call({ survivingId: keep.id, duplicateId: client.id }, OWNER);
    const [merged] = await db()
      .select()
      .from(galleryRounds)
      .where(eq(galleryRounds.galleryId, gallery.id));
    expect(merged!.submittedByContactId).toBe(keep.id);

    const { contactPrivacySources } = await import("@/core/privacy/service");
    for (const source of contactPrivacySources().filter(
      (entry) => entry.scope === "contact.galleries",
    )) {
      await db().transaction((tx) => source.erase(tx, keep.id, { requestId: "erase-test" }));
    }
    const [erased] = await db()
      .select()
      .from(galleryRounds)
      .where(eq(galleryRounds.galleryId, gallery.id));
    // What was agreed is the owner's record of the job; only the name goes.
    expect(erased!.submittedByContactId).toBeNull();
    expect((erased!.snapshot as unknown[]).length).toBe(1);
  });
});
