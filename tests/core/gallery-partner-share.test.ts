// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner-permitted client-issued gallery partner sharing (MASTER.md C9.29, §34).
//
// The rules:
//
//   1. Off until the owner opts the gallery in.
//   2. The named client who already opened the gallery may invite a partner.
//   3. A partner cannot invite anyone else.
//   4. The invite is a scoped guest: view, not download, and contacts.resolve.
//   5. The client cannot rotate or revoke an owner-issued guest.
//   6. Merge repoints invited_by_contact_id; erasure of the client nulls it.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { contacts } from "@/core/contacts/schema";
import { createContact, mergeContacts } from "@/core/contacts/service";
import { updateBusiness } from "@/core/settings/service";
import {
  createGallery,
  inviteGalleryGuest,
  inviteGalleryPartner,
  redeemGalleryGuest,
  revokeGalleryGuest,
  revokeGalleryPartner,
  unlockGallery,
  updateGallery,
  viewGallerySession,
} from "@/modules/galleries/service";
import { galleries, galleryGuests } from "@/modules/galleries/schema";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe.runIf(hasDatabase)("client-issued gallery partner sharing", { timeout: 90_000 }, () => {
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

  async function person(email = "client@example.test") {
    return createContact.call({ name: "Rae Lane", email }, OWNER);
  }

  function openedSession<T extends { ok: boolean }>(
    opened: T,
  ): asserts opened is T & { ok: true; sessionToken: string; gallery: { id: string } } {
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error("expected the gallery to open");
  }

  it("refuses a client partner invite until the owner opts the gallery in", async () => {
    const client = await person();
    const gallery = await createGallery.call(
      { contactId: client.id, title: "Closed proofs", access: "pin", secret: "2468" },
      OWNER,
    );
    expect(gallery.clientCanInvitePartner).toBe(false);
    const opened = await unlockGallery.call({ slug: gallery.slug, secret: "2468" }, ANONYMOUS);
    openedSession(opened);
    expect(opened.canInvitePartner).toBe(false);
    expect(
      (await failure(
        inviteGalleryPartner.call(
          { sessionToken: opened.sessionToken, email: "partner@example.test" },
          ANONYMOUS,
        ),
      )).message,
    ).toContain("cannot be shared");
  });

  it("lets the client invite a partner once the owner has allowed it", async () => {
    const client = await person();
    const gallery = await createGallery.call(
      { contactId: client.id, title: "Shared proofs", access: "pin", secret: "2468" },
      OWNER,
    );
    await updateGallery.call({ id: gallery.id, clientCanInvitePartner: true }, OWNER);
    const opened = await unlockGallery.call({ slug: gallery.slug, secret: "2468" }, ANONYMOUS);
    openedSession(opened);
    expect(opened.canInvitePartner).toBe(true);
    const guest = await inviteGalleryPartner.call(
      { sessionToken: opened.sessionToken, email: "partner@example.test", name: "Sam Partner" },
      ANONYMOUS,
    );
    expect(guest.role).toBe("partner");
    expect(guest.canDownload).toBe(false);
    expect(guest.invitedByContactId).toBe(client.id);
    expect(guest.token).toBeTruthy();
    const people = await db().select().from(contacts);
    expect(people.filter((row) => row.email === "partner@example.test")).toHaveLength(1);
    const redeemed = await redeemGalleryGuest.call({ token: guest.token }, ANONYMOUS);
    openedSession(redeemed);
    expect(redeemed.gallery.id).toBe(gallery.id);
    expect(redeemed.canInvitePartner).toBe(false);
  });

  it("resolves a client invite onto an existing contact rather than minting a second person", async () => {
    const client = await person();
    const existing = await createContact.call(
      { name: "Sam Partner", email: "partner@example.test" },
      OWNER,
    );
    const gallery = await createGallery.call(
      {
        contactId: client.id,
        title: "Resolved proofs",
        access: "pin",
        secret: "2468",
        clientCanInvitePartner: true,
      },
      OWNER,
    );
    const opened = await unlockGallery.call({ slug: gallery.slug, secret: "2468" }, ANONYMOUS);
    openedSession(opened);
    const guest = await inviteGalleryPartner.call(
      { sessionToken: opened.sessionToken, email: "partner@example.test" },
      ANONYMOUS,
    );
    expect(guest.contactId).toBe(existing.id);
  });

  it("will not let a partner invite anyone else", async () => {
    const client = await person();
    const gallery = await createGallery.call(
      {
        contactId: client.id,
        title: "One hop",
        access: "pin",
        secret: "2468",
        clientCanInvitePartner: true,
      },
      OWNER,
    );
    const opened = await unlockGallery.call({ slug: gallery.slug, secret: "2468" }, ANONYMOUS);
    openedSession(opened);
    const guest = await inviteGalleryPartner.call(
      { sessionToken: opened.sessionToken, email: "partner@example.test" },
      ANONYMOUS,
    );
    const partner = await redeemGalleryGuest.call({ token: guest.token }, ANONYMOUS);
    openedSession(partner);
    expect(
      (await failure(
        inviteGalleryPartner.call(
          { sessionToken: partner.sessionToken, email: "third@example.test" },
          ANONYMOUS,
        ),
      )).message,
    ).toContain("cannot be shared");
  });

  it("will not let the client invite themselves or rotate an owner-issued guest", async () => {
    const client = await person();
    const gallery = await createGallery.call(
      {
        contactId: client.id,
        title: "Owned proofs",
        access: "pin",
        secret: "2468",
        clientCanInvitePartner: true,
      },
      OWNER,
    );
    const ownerGuest = await inviteGalleryGuest.call(
      { galleryId: gallery.id, email: "owner-guest@example.test", role: "partner" },
      OWNER,
    );
    const opened = await unlockGallery.call({ slug: gallery.slug, secret: "2468" }, ANONYMOUS);
    openedSession(opened);
    expect(
      (await failure(
        inviteGalleryPartner.call(
          { sessionToken: opened.sessionToken, email: "client@example.test" },
          ANONYMOUS,
        ),
      )).message,
    ).toContain("already yours");
    expect(
      (await failure(
        inviteGalleryPartner.call(
          { sessionToken: opened.sessionToken, email: "owner-guest@example.test" },
          ANONYMOUS,
        ),
      )).message,
    ).toContain("already has access");
    expect(
      (await failure(
        revokeGalleryPartner.call(
          { sessionToken: opened.sessionToken, id: ownerGuest.id },
          ANONYMOUS,
        ),
      )).message,
    ).toContain("not here");
  });

  it("lets the client revoke a partner they invited, and lists them on the session", async () => {
    const client = await person();
    const gallery = await createGallery.call(
      {
        contactId: client.id,
        title: "Revoke proofs",
        access: "pin",
        secret: "2468",
        clientCanInvitePartner: true,
      },
      OWNER,
    );
    const opened = await unlockGallery.call({ slug: gallery.slug, secret: "2468" }, ANONYMOUS);
    openedSession(opened);
    const guest = await inviteGalleryPartner.call(
      { sessionToken: opened.sessionToken, email: "partner@example.test" },
      ANONYMOUS,
    );
    const viewing = await viewGallerySession.call(
      { sessionToken: opened.sessionToken },
      ANONYMOUS,
    );
    expect(viewing.invitedPartners.map((row) => row.id)).toEqual([guest.id]);
    await revokeGalleryPartner.call(
      { sessionToken: opened.sessionToken, id: guest.id },
      ANONYMOUS,
    );
    expect(
      (await failure(redeemGalleryGuest.call({ token: guest.token }, ANONYMOUS))).message,
    ).toContain("That did not work");
    const after = await viewGallerySession.call(
      { sessionToken: opened.sessionToken },
      ANONYMOUS,
    );
    expect(after.invitedPartners).toEqual([]);
  });

  it("repoints invited_by_contact_id on merge", async () => {
    const keep = await person("keep@example.test");
    const drop = await createContact.call({ name: "Rae Duplicate", email: "drop@example.test" }, OWNER);
    const gallery = await createGallery.call(
      {
        contactId: drop.id,
        title: "Merge partner proofs",
        access: "pin",
        secret: "2468",
        clientCanInvitePartner: true,
      },
      OWNER,
    );
    const opened = await unlockGallery.call({ slug: gallery.slug, secret: "2468" }, ANONYMOUS);
    openedSession(opened);
    const guest = await inviteGalleryPartner.call(
      { sessionToken: opened.sessionToken, email: "partner@example.test" },
      ANONYMOUS,
    );
    expect(guest.invitedByContactId).toBe(drop.id);
    await mergeContacts.call({ survivingId: keep.id, duplicateId: drop.id }, OWNER);
    const [row] = await db().select().from(galleryGuests).where(eq(galleryGuests.id, guest.id));
    expect(row!.invitedByContactId).toBe(keep.id);
    const [galleryRow] = await db().select().from(galleries).where(eq(galleries.id, gallery.id));
    expect(galleryRow!.contactId).toBe(keep.id);
  });

  it("nulls invited_by_contact_id when the client is erased and keeps the partner guest", async () => {
    const client = await person();
    const gallery = await createGallery.call(
      {
        contactId: client.id,
        title: "Erase partner proofs",
        access: "pin",
        secret: "2468",
        clientCanInvitePartner: true,
      },
      OWNER,
    );
    const opened = await unlockGallery.call({ slug: gallery.slug, secret: "2468" }, ANONYMOUS);
    openedSession(opened);
    const guest = await inviteGalleryPartner.call(
      { sessionToken: opened.sessionToken, email: "partner@example.test" },
      ANONYMOUS,
    );
    const { contactPrivacySources } = await import("@/core/privacy/service");
    for (const source of contactPrivacySources().filter((entry) => entry.scope === "contact.galleries")) {
      await db().transaction((tx) => source.erase(tx, client.id, { requestId: "erase-partner" }));
    }
    const [row] = await db().select().from(galleryGuests).where(eq(galleryGuests.id, guest.id));
    expect(row).toMatchObject({
      id: guest.id,
      role: "partner",
      invitedByContactId: null,
    });
  });

  it("still lets the owner invite a partner when the client cannot", async () => {
    const client = await person();
    const gallery = await createGallery.call(
      { contactId: client.id, title: "Owner still invites", access: "login" },
      OWNER,
    );
    const guest = await inviteGalleryGuest.call(
      { galleryId: gallery.id, email: "partner@example.test", role: "partner" },
      OWNER,
    );
    expect(guest.invitedByContactId).toBeNull();
    await revokeGalleryGuest.call({ id: guest.id }, OWNER);
  });
});
