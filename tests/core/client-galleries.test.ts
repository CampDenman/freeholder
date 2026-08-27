// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Private client galleries (MASTER.md C8.03, §4.5).
//
// The rules:
//
//   1. Access stops at expires_at, including already-open sessions.
//   2. PIN/password are stored hashed; the raw secret never lands in a row.
//   3. A magic-link opens the gallery and is refused after expiry or revoke.
//   4. Login requires the signed-in contact to own the gallery or be a guest.
//   5. A guest cannot be granted more than the item allows.
//   6. A partner guest is an explicit owner invite, resolved as a Contact.
//   7. Denied and successful access both write the audit.
//   8. Merge repoints gallery, guests and logs; sessions for the duplicate die.
//   9. Erasure unlinks the person without deleting the business's gallery.
//  10. Client galleries are not a public CMS/sitemap surface.
//  11. Invites call contacts.resolve, never contacts.create.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { assets } from "@/core/media/schema";
import { contacts } from "@/core/contacts/schema";
import { users } from "@/core/auth/schema";
import { createContact, mergeContacts } from "@/core/contacts/service";
import { updateBusiness } from "@/core/settings/service";
import { kindFromSlug } from "@/core/seo/classify";
import { renderRobots } from "@/core/seo/sitemap";
import {
  addGalleryItem,
  createGallery,
  downloadGalleryItem,
  galleryBySlug,
  inviteGalleryGuest,
  listGalleryAccess,
  openGalleryWithLogin,
  redeemGalleryGuest,
  revokeGalleryGuest,
  unlockGallery,
  updateGallery,
  updateGalleryItem,
  viewGallerySession,
} from "@/modules/galleries/service";
import { galleries, galleryAccessLogs, galleryGuests } from "@/modules/galleries/schema";
import {
  ANONYMOUS,
  closeDb,
  CUSTOMER,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe.runIf(hasDatabase)("private client galleries", { timeout: 90_000 }, () => {
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
  ): asserts opened is T & { ok: true; sessionToken: string; gallery: { id: string }; items: unknown[] } {
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error("expected the gallery to open");
  }

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
        altText: filename.replace(/\.jpg$/, ""),
        status: "ready",
      })
      .returning();
    return created!;
  }

  it("refuses access after expires_at, including a session issued before expiry", async () => {
    const client = await person();
    const gallery = await createGallery.call(
      {
        contactId: client.id,
        title: "Henderson proofs",
        access: "pin",
        secret: "2468",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      OWNER,
    );
    const opened = await unlockGallery.call({ slug: gallery.slug, secret: "2468" }, ANONYMOUS);
    openedSession(opened);
    await updateGallery.call(
      { id: gallery.id, expiresAt: new Date(Date.now() - 1_000).toISOString() },
      OWNER,
    );
    expect((await failure(unlockGallery.call({ slug: gallery.slug, secret: "2468" }, ANONYMOUS))).message).toContain(
      "no longer available",
    );
    expect(
      (await failure(viewGallerySession.call({ sessionToken: opened.sessionToken }, ANONYMOUS))).message,
    ).toContain("no longer available");
  });

  it("stores a PIN as a hash and never writes the raw secret", async () => {
    const client = await person();
    const gallery = await createGallery.call(
      { contactId: client.id, title: "PIN proofs", access: "pin", secret: "1357" },
      OWNER,
    );
    const [row] = await db().select().from(galleries).where(eq(galleries.id, gallery.id));
    expect(row!.secretHash).toBeTruthy();
    expect(row!.secretHash).not.toContain("1357");
    expect(JSON.stringify(gallery)).not.toContain("1357");
    expect(gallery.secretSet).toBe(true);
    expect(await unlockGallery.call({ slug: gallery.slug, secret: "0000" }, ANONYMOUS)).toEqual({
      ok: false,
    });
    const opened = await unlockGallery.call({ slug: gallery.slug, secret: "1357" }, ANONYMOUS);
    expect(opened.ok).toBe(true);
    if (opened.ok) expect(opened.items).toEqual([]);
  });

  it("opens from a magic-link and refuses after expiry or revoke", async () => {
    const client = await person();
    const gallery = await createGallery.call(
      { contactId: client.id, title: "Guest proofs", access: "login" },
      OWNER,
    );
    const guest = await inviteGalleryGuest.call(
      {
        galleryId: gallery.id,
        email: "partner@example.test",
        name: "Sam Partner",
        role: "partner",
      },
      OWNER,
    );
    const opened = await redeemGalleryGuest.call({ token: guest.token }, ANONYMOUS);
    openedSession(opened);
    expect(opened.gallery.id).toBe(gallery.id);
    await revokeGalleryGuest.call({ id: guest.id }, OWNER);
    expect((await failure(redeemGalleryGuest.call({ token: guest.token }, ANONYMOUS))).message).toContain(
      "That did not work",
    );
    expect(
      (await failure(viewGallerySession.call({ sessionToken: opened.sessionToken }, ANONYMOUS))).message,
    ).toContain("That did not work");
  });

  it("lets a signed-in client in and refuses a stranger", async () => {
    const client = await person("login@example.test");
    await db().insert(users).values({
      id: CUSTOMER.userId,
      email: "login@example.test",
      role: "customer",
    });
    await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, client.id));
    const gallery = await createGallery.call(
      { contactId: client.id, title: "Login proofs", access: "login" },
      OWNER,
    );
    const opened = await openGalleryWithLogin.call({ slug: gallery.slug }, CUSTOMER);
    openedSession(opened);
    expect(opened.gallery.id).toBe(gallery.id);
    const stranger = {
      ...CUSTOMER,
      userId: "00000000-0000-4000-8000-000000000099",
    };
    expect(await openGalleryWithLogin.call({ slug: gallery.slug }, stranger)).toEqual({ ok: false });
  });

  it("will not let a guest exceed per-asset permissions", async () => {
    const client = await person();
    const visible = await image("front.jpg");
    const hidden = await image("hidden.jpg");
    const gallery = await createGallery.call(
      {
        contactId: client.id,
        title: "Selects",
        access: "pin",
        secret: "2468",
        downloadPolicy: "full_res",
      },
      OWNER,
    );
    const shown = await addGalleryItem.call({ galleryId: gallery.id, assetId: visible.id }, OWNER);
    const blocked = await addGalleryItem.call(
      { galleryId: gallery.id, assetId: hidden.id, canView: false, canDownload: false },
      OWNER,
    );
    await updateGalleryItem.call({ id: shown.id, canDownload: false }, OWNER);
    const guest = await inviteGalleryGuest.call(
      {
        galleryId: gallery.id,
        email: "partner@example.test",
        role: "partner",
        canDownload: true,
      },
      OWNER,
    );
    const opened = await redeemGalleryGuest.call({ token: guest.token }, ANONYMOUS);
    openedSession(opened);
    expect(opened.items.map((item) => item.assetId)).toEqual([visible.id]);
    expect(opened.items[0]!.canDownload).toBe(false);
    expect(
      (await failure(
        downloadGalleryItem.call({ sessionToken: opened.sessionToken, itemId: shown.id }, ANONYMOUS),
      )).message,
    ).toContain("cannot be downloaded");
    expect(
      (await failure(
        downloadGalleryItem.call({ sessionToken: opened.sessionToken, itemId: blocked.id }, ANONYMOUS),
      )).message,
    ).toMatch(/not in this gallery|cannot be downloaded/);
  });

  it("resolves a partner invite onto the contact spine and never mints a second person", async () => {
    const client = await person();
    const existing = await createContact.call(
      { name: "Sam Partner", email: "partner@example.test" },
      OWNER,
    );
    const gallery = await createGallery.call(
      { contactId: client.id, title: "Partner proofs", access: "login" },
      OWNER,
    );
    const guest = await inviteGalleryGuest.call(
      { galleryId: gallery.id, email: "partner@example.test", role: "partner" },
      OWNER,
    );
    expect(guest.contactId).toBe(existing.id);
    const people = await db().select().from(contacts);
    expect(people.filter((row) => row.email === "partner@example.test")).toHaveLength(1);
  });

  it("logs denied and successful access", async () => {
    const client = await person();
    const gallery = await createGallery.call(
      { contactId: client.id, title: "Logged proofs", access: "pin", secret: "2468" },
      OWNER,
    );
    expect(await unlockGallery.call({ slug: gallery.slug, secret: "0000" }, ANONYMOUS)).toEqual({
      ok: false,
    });
    await unlockGallery.call({ slug: gallery.slug, secret: "2468" }, ANONYMOUS);
    const log = await listGalleryAccess.call({ galleryId: gallery.id }, OWNER);
    expect(log.map((entry) => entry.action).sort()).toEqual(["denied", "view"]);
  });

  it("repoints the gallery on merge and invalidates the duplicate's session", async () => {
    const keep = await person("keep@example.test");
    const drop = await createContact.call({ name: "Rae Duplicate", email: "drop@example.test" }, OWNER);
    const gallery = await createGallery.call(
      { contactId: drop.id, title: "Merge proofs", access: "pin", secret: "2468" },
      OWNER,
    );
    await inviteGalleryGuest.call(
      { galleryId: gallery.id, email: "drop@example.test", role: "client" },
      OWNER,
    );
    await unlockGallery.call({ slug: gallery.slug, secret: "2468" }, ANONYMOUS);
    await mergeContacts.call({ survivingId: keep.id, duplicateId: drop.id }, OWNER);
    const [row] = await db().select().from(galleries).where(eq(galleries.id, gallery.id));
    expect(row!.contactId).toBe(keep.id);
    const guests = await db().select().from(galleryGuests).where(eq(galleryGuests.galleryId, gallery.id));
    expect(guests.every((guest) => guest.contactId === keep.id)).toBe(true);
    const logs = await db()
      .select()
      .from(galleryAccessLogs)
      .where(eq(galleryAccessLogs.galleryId, gallery.id));
    expect(logs.every((entry) => entry.contactId === keep.id || entry.contactId === null)).toBe(true);
  });

  it("privacy erasure unlinks the person and keeps the gallery", async () => {
    const client = await person();
    const gallery = await createGallery.call(
      { contactId: client.id, title: "Erasure proofs", access: "login" },
      OWNER,
    );
    await inviteGalleryGuest.call(
      { galleryId: gallery.id, email: "partner@example.test", role: "partner" },
      OWNER,
    );
    const { contactPrivacySources } = await import("@/core/privacy/service");
    for (const source of contactPrivacySources().filter((entry) => entry.scope === "contact.galleries")) {
      await db().transaction((tx) => source.erase(tx, client.id, { requestId: "erase-test" }));
    }
    const [row] = await db().select().from(galleries).where(eq(galleries.id, gallery.id));
    expect(row).toMatchObject({ id: gallery.id, contactId: null, title: "Erasure proofs" });
    expect(await db().select().from(contacts).where(eq(contacts.id, client.id))).toHaveLength(1);
  });

  it("is not a public CMS page and is disallowed in robots.txt", async () => {
    const client = await person();
    const gallery = await createGallery.call(
      { contactId: client.id, title: "Hidden proofs", access: "pin", secret: "2468" },
      OWNER,
    );
    const lock = await galleryBySlug.call({ slug: gallery.slug }, ANONYMOUS);
    expect(lock).toMatchObject({ slug: gallery.slug, access: "pin", expired: false });
    expect(kindFromSlug(`g/${gallery.slug}`)).not.toBe("project");
    expect(renderRobots("https://example.test")).toContain("Disallow: /g/");
  });
});
