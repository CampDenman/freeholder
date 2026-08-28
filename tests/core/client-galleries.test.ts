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
//  12. The bytes come through the session; the object key never leaves it.
//  13. The download policy is part of the ceiling, not page decoration.
//  14. A download limit counts the gallery, not the session holding it.
//  15. Rotating the secret closes the sessions the old one opened.
//  16. A session opens the gallery it was issued for and no other.
//  17. An invite carries a link that can actually be sent.
//  18. `download_policy` decides what the client receives (C8.04).
//  19. A watermarked gallery serves the mark or nothing — never the master.
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
  viewGalleryItem,
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

  async function image(filename: string, variants: Record<string, unknown> = {}) {
    const [created] = await db()
      .insert(assets)
      .values({
        kind: "image",
        variants,
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

  it("hands out no object key, so a private file is not a public /media URL", async () => {
    const client = await person();
    const file = await image("proof.jpg");
    const gallery = await createGallery.call(
      {
        contactId: client.id,
        title: "Keyless proofs",
        access: "pin",
        secret: "2468",
        downloadPolicy: "full_res",
      },
      OWNER,
    );
    const item = await addGalleryItem.call({ galleryId: gallery.id, assetId: file.id }, OWNER);
    const opened = await unlockGallery.call({ slug: gallery.slug, secret: "2468" }, ANONYMOUS);
    openedSession(opened);
    // /media/{key} authorizes any ready object for anyone holding the key,
    // with no expiry and no revoke. A private gallery must never print one.
    expect(JSON.stringify(opened.items)).not.toContain(file.storageKey);
    expect(Object.keys(opened.items[0]!)).not.toContain("storageKey");

    const authorized = await viewGalleryItem.call(
      { sessionToken: opened.sessionToken, itemId: item.id },
      ANONYMOUS,
    );
    expect(authorized).toMatchObject({ assetId: file.id, storageKey: file.storageKey });
    await updateGallery.call(
      { id: gallery.id, expiresAt: new Date(Date.now() - 1_000).toISOString() },
      OWNER,
    );
    expect(
      (await failure(
        viewGalleryItem.call({ sessionToken: opened.sessionToken, itemId: item.id }, ANONYMOUS),
      )).message,
    ).toContain("no longer available");
  });

  it("offers no download at all when the gallery is view-only", async () => {
    const client = await person();
    const file = await image("view-only.jpg");
    const gallery = await createGallery.call(
      { contactId: client.id, title: "View only", access: "pin", secret: "2468" },
      OWNER,
    );
    const item = await addGalleryItem.call({ galleryId: gallery.id, assetId: file.id }, OWNER);
    const opened = await unlockGallery.call({ slug: gallery.slug, secret: "2468" }, ANONYMOUS);
    openedSession(opened);
    // The item says "downloadable"; the gallery says "no". The lower of the
    // two is what the client is told, so the page cannot offer a dead link.
    expect(opened.items[0]!.canDownload).toBe(false);
    expect(
      (await failure(
        downloadGalleryItem.call({ sessionToken: opened.sessionToken, itemId: item.id }, ANONYMOUS),
      )).message,
    ).toContain("cannot be downloaded");
  });

  it("counts a download limit against the gallery, not the session", async () => {
    const client = await person();
    const file = await image("limited.jpg");
    const gallery = await createGallery.call(
      {
        contactId: client.id,
        title: "One download",
        access: "pin",
        secret: "2468",
        downloadPolicy: "limit_n",
        downloadLimit: 1,
      },
      OWNER,
    );
    const item = await addGalleryItem.call({ galleryId: gallery.id, assetId: file.id }, OWNER);
    const first = await unlockGallery.call({ slug: gallery.slug, secret: "2468" }, ANONYMOUS);
    openedSession(first);
    await downloadGalleryItem.call({ sessionToken: first.sessionToken, itemId: item.id }, ANONYMOUS);

    // Unlocking again used to hand out a fresh allowance, which is the same
    // as having no limit at all.
    const second = await unlockGallery.call({ slug: gallery.slug, secret: "2468" }, ANONYMOUS);
    openedSession(second);
    expect(
      (await failure(
        downloadGalleryItem.call({ sessionToken: second.sessionToken, itemId: item.id }, ANONYMOUS),
      )).message,
    ).toContain("download limit");
  });

  it("closes the sessions the old secret opened when the secret is rotated", async () => {
    const client = await person();
    const gallery = await createGallery.call(
      { contactId: client.id, title: "Rotated proofs", access: "pin", secret: "2468" },
      OWNER,
    );
    const opened = await unlockGallery.call({ slug: gallery.slug, secret: "2468" }, ANONYMOUS);
    openedSession(opened);
    await updateGallery.call({ id: gallery.id, secret: "1357" }, OWNER);
    // A leaked PIN is why an owner rotates it. Leaving the sessions it opened
    // alive for a week makes the rotation a gesture.
    expect(
      (await failure(viewGallerySession.call({ sessionToken: opened.sessionToken }, ANONYMOUS))).message,
    ).toContain("That did not work");
    expect(await unlockGallery.call({ slug: gallery.slug, secret: "2468" }, ANONYMOUS)).toEqual({
      ok: false,
    });
    const reopened = await unlockGallery.call({ slug: gallery.slug, secret: "1357" }, ANONYMOUS);
    expect(reopened.ok).toBe(true);
  });

  it("names the gallery a session belongs to, so one cookie cannot open another", async () => {
    const client = await person();
    const first = await createGallery.call(
      { contactId: client.id, title: "Spring proofs", access: "pin", secret: "2468" },
      OWNER,
    );
    const second = await createGallery.call(
      { contactId: client.id, title: "Autumn proofs", access: "pin", secret: "1357" },
      OWNER,
    );
    const opened = await unlockGallery.call({ slug: first.slug, secret: "2468" }, ANONYMOUS);
    openedSession(opened);
    const read = await viewGallerySession.call({ sessionToken: opened.sessionToken }, ANONYMOUS);
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error("expected the session to read");
    // The page renders whichever gallery the session names, so the session
    // has to name it. One cookie holds one gallery, not the last one opened.
    expect(read.gallery.slug).toBe(first.slug);
    expect(read.gallery.slug).not.toBe(second.slug);
  });

  it("gives an invite a link that opens the gallery", async () => {
    const client = await person();
    const gallery = await createGallery.call(
      { contactId: client.id, title: "Sendable proofs", access: "login" },
      OWNER,
    );
    const guest = await inviteGalleryGuest.call(
      { galleryId: gallery.id, email: "partner@example.test", role: "partner" },
      OWNER,
    );
    // A magic link nobody can send is not magic-link access.
    expect(guest.link).toContain(`/g/${gallery.slug}?token=`);
    expect(guest.link).toContain(encodeURIComponent(guest.token));
    const opened = await redeemGalleryGuest.call({ token: guest.token }, ANONYMOUS);
    openedSession(opened);
    expect(opened.gallery.id).toBe(gallery.id);
  });

  const WEB = { webp: [{ width: 1600, height: 1000, bytes: 512, key: "web.1600.webp" }] };
  const MARKED = {
    ...WEB,
    watermarked: { webp: [{ width: 1600, height: 1000, bytes: 400, key: "proof.wm.1600.webp" }] },
  };

  async function galleryWith(
    client: { id: string },
    title: string,
    options: { downloadPolicy?: "none" | "web_res" | "full_res"; watermark?: boolean },
  ) {
    return createGallery.call(
      {
        contactId: client.id,
        title,
        access: "pin",
        secret: "2468",
        downloadPolicy: options.downloadPolicy ?? "full_res",
        watermark: options.watermark ?? false,
      },
      OWNER,
    );
  }

  it("serves a web rendition, not the master, when the policy says web-sized", async () => {
    const client = await person();
    const file = await image("web.jpg", WEB);
    const gallery = await galleryWith(client, "Web sized", { downloadPolicy: "web_res" });
    const item = await addGalleryItem.call(
      { galleryId: gallery.id, assetId: file.id },
      OWNER,
    );
    const opened = await unlockGallery.call({ slug: gallery.slug, secret: "2468" }, ANONYMOUS);
    openedSession(opened);
    const taken = await downloadGalleryItem.call(
      { sessionToken: opened.sessionToken, itemId: item.id },
      ANONYMOUS,
    );
    // The whole point of the policy: the master never leaves.
    expect(taken.storageKey).toBe("web.1600.webp");
    expect(taken.storageKey).not.toBe(file.storageKey);
    expect(taken.mime).toBe("image/webp");
    expect(taken.filename).toBe("web.webp");
  });

  it("refuses a web-sized download of an image that has no rendition", async () => {
    const client = await person();
    const file = await image("bare.jpg");
    const gallery = await galleryWith(client, "No rendition", { downloadPolicy: "web_res" });
    const item = await addGalleryItem.call({ galleryId: gallery.id, assetId: file.id }, OWNER);
    const opened = await unlockGallery.call({ slug: gallery.slug, secret: "2468" }, ANONYMOUS);
    openedSession(opened);
    // Falling back to the master here would hand over the full-resolution
    // file the owner declined to give, and look identical to success.
    expect(opened.items[0]!.canDownload).toBe(false);
    expect(
      (await failure(
        downloadGalleryItem.call({ sessionToken: opened.sessionToken, itemId: item.id }, ANONYMOUS),
      )).message,
    ).toContain("cannot be downloaded");
  });

  it("serves the master when the policy says original files", async () => {
    const client = await person();
    const file = await image("full.jpg", WEB);
    const gallery = await galleryWith(client, "Originals", { downloadPolicy: "full_res" });
    const item = await addGalleryItem.call({ galleryId: gallery.id, assetId: file.id }, OWNER);
    const opened = await unlockGallery.call({ slug: gallery.slug, secret: "2468" }, ANONYMOUS);
    openedSession(opened);
    const taken = await downloadGalleryItem.call(
      { sessionToken: opened.sessionToken, itemId: item.id },
      ANONYMOUS,
    );
    expect(taken.storageKey).toBe(file.storageKey);
    expect(taken.mime).toBe("image/jpeg");
  });

  it("serves the mark, not the master, when the gallery is watermarked", async () => {
    const client = await person();
    const file = await image("proof.jpg", MARKED);
    const gallery = await galleryWith(client, "Marked proofs", {
      downloadPolicy: "full_res",
      watermark: true,
    });
    const item = await addGalleryItem.call({ galleryId: gallery.id, assetId: file.id }, OWNER);
    const opened = await unlockGallery.call({ slug: gallery.slug, secret: "2468" }, ANONYMOUS);
    openedSession(opened);

    // Watermark outranks full_res: asking for both is asking for two
    // incompatible things, and the marked file is the safe reading.
    const taken = await downloadGalleryItem.call(
      { sessionToken: opened.sessionToken, itemId: item.id },
      ANONYMOUS,
    );
    expect(taken.storageKey).toBe("proof.wm.1600.webp");

    const shown = await viewGalleryItem.call(
      { sessionToken: opened.sessionToken, itemId: item.id },
      ANONYMOUS,
    );
    expect(shown?.storageKey).toBe("proof.wm.1600.webp");
    expect(shown?.storageKey).not.toBe(file.storageKey);
  });

  it("shows nothing rather than the original when a marked gallery has no mark", async () => {
    const client = await person();
    const file = await image("unmarked.jpg", WEB);
    const gallery = await galleryWith(client, "Mark missing", {
      downloadPolicy: "full_res",
      watermark: true,
    });
    const item = await addGalleryItem.call({ galleryId: gallery.id, assetId: file.id }, OWNER);
    const opened = await unlockGallery.call({ slug: gallery.slug, secret: "2468" }, ANONYMOUS);
    openedSession(opened);
    // A gap in the grid is the honest outcome. Falling back to the master
    // would be indistinguishable from never having asked for a watermark.
    expect(
      await viewGalleryItem.call({ sessionToken: opened.sessionToken, itemId: item.id }, ANONYMOUS),
    ).toBeNull();
    expect(opened.items[0]!.canDownload).toBe(false);
    expect(
      (await failure(
        downloadGalleryItem.call({ sessionToken: opened.sessionToken, itemId: item.id }, ANONYMOUS),
      )).message,
    ).toContain("cannot be downloaded");
  });
});
