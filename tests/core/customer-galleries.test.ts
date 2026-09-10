// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.29: the portal list and image transport share real gallery permissions.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { assets } from "@/core/media/schema";
import { resolveContact } from "@/core/contacts/service";
import { myRecords } from "@/core/portal/service";
import { updateBusiness } from "@/core/settings/service";
import { storage } from "@/adapters/storage";
import { addGalleryItem, createGallery, inviteGalleryGuest, myGalleries, openGalleryWithLogin, revokeGalleryGuest, updateGallery, updateGalleryItem } from "@/modules/galleries/service";
import { galleryGuests } from "@/modules/galleries/schema";
import { ANONYMOUS, closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
import { GET } from "../../app/g/[slug]/view/[itemId]/route";

const cookie = vi.hoisted(() => ({ token: undefined as string | undefined, reads: 0 }));
vi.mock("next/headers", () => ({ cookies: async () => {
  cookie.reads++;
  return { get: () => cookie.token ? { value: cookie.token } : undefined };
} }));

describe.runIf(hasDatabase)("customer gallery foundation", () => {
  beforeAll(async () => { await ready(); }, 60_000);
  beforeEach(async () => {
    vi.restoreAllMocks();
    cookie.token = undefined;
    cookie.reads = 0;
    await truncateSpine();
    await updateBusiness.call({ name: "Coastal proofs", country: "CA", baseCurrency: "CAD", timezone: "America/Vancouver" }, OWNER);
  });
  afterAll(closeDb);

  async function customer() {
    const { contact } = await resolveContact.call({ email: "gallery-client@example.test", name: "Rae" }, OWNER);
    await db().insert(users).values({ id: CUSTOMER.userId, email: contact.email!, role: "customer" });
    await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, contact.id));
    return contact;
  }

  async function gallery(contactId: string, title = "Coast portraits") {
    return createGallery.call({ contactId, title, access: "login" }, OWNER);
  }

  async function imageFixture() {
    const contact = await customer();
    const own = await gallery(contact.id);
    const [asset] = await db().insert(assets).values({ kind: "image", storageKey: "test/customer-gallery.jpg",
      filename: "portrait.jpg", mime: "image/jpeg", legacyBytes: 3, bytes: 3, status: "ready", altText: "A coastal portrait" }).returning();
    const item = await addGalleryItem.call({ galleryId: own.id, assetId: asset!.id }, OWNER);
    const opened = await openGalleryWithLogin.call({ slug: own.slug }, CUSTOMER);
    if (!opened.ok) throw new Error("Expected the client's gallery to open");
    const bytes = vi.spyOn(storage(), "get").mockResolvedValue(new Uint8Array([1, 2, 3]));
    return { own, item, opened, bytes };
  }

  function imageRequest(slug: string, itemId: string, authorization?: string, query = "") {
    return GET(new Request(`https://business.example/g/${slug}/view/${itemId}${query}`, {
      headers: authorization === undefined ? {} : { authorization },
    }), { params: Promise.resolve({ slug, itemId }) });
  }

  it("lists only the caller's live galleries and guest invitations, without credentials or duplicates", async () => {
    const client = await customer();
    const other = (await resolveContact.call({ email: "other@example.test", name: "Sam" }, OWNER)).contact;
    const own = await gallery(client.id);
    const shared = await gallery(other.id, "Shared portraits");
    await gallery(other.id, "Private to Sam");
    const expired = await gallery(client.id, "Expired portraits");
    await updateGallery.call({ id: expired.id, expiresAt: new Date(Date.now() - 1_000).toISOString() }, OWNER);
    const invited = await inviteGalleryGuest.call({ galleryId: shared.id, email: client.email!, role: "partner" }, OWNER);
    await inviteGalleryGuest.call({ galleryId: own.id, email: client.email!, role: "client" }, OWNER);
    const rows = await myGalleries.call({}, CUSTOMER);
    expect(rows.map((row) => row.id).sort()).toEqual([own.id, shared.id].sort());
    const ownerCustomer = { ...OWNER, userId: CUSTOMER.userId };
    expect((await myGalleries.call({}, ownerCustomer)).map((row) => row.id)).toEqual(rows.map((row) => row.id));
    expect(Object.keys(rows[0]!).sort()).toEqual(["expiresAt", "id", "slug", "title", "updatedAt"]);
    const room = (await myRecords.call({ section: "galleries" }, CUSTOMER))[0]!;
    expect(room.failed).toBe(false);
    expect(room.records.map((row) => row.href).sort()).toEqual([`/g/${own.slug}`, `/g/${shared.slug}`].sort());
    expect(await myGalleries.call({ limit: 1 }, CUSTOMER)).toHaveLength(1);
    await revokeGalleryGuest.call({ id: invited.id }, OWNER);
    expect((await myGalleries.call({}, CUSTOMER)).map((row) => row.id)).toEqual([own.id]);
    expect((await failure(myGalleries.call({}, ANONYMOUS))).code).toBe("permission");
    expect((await failure(myGalleries.call({}, OWNER))).code).toBe("not_found");
    const forged = { limit: 100, contactId: other.id };
    expect((await failure(myGalleries.call(forged, CUSTOMER))).code).toBe("validation");
  });

  it("removes expired guest invitations from both listing and login", async () => {
    const client = await customer();
    const other = (await resolveContact.call({ email: "owner@example.test", name: "Sam" }, OWNER)).contact;
    const shared = await gallery(other.id);
    const guest = await inviteGalleryGuest.call({ galleryId: shared.id, email: client.email!, role: "partner" }, OWNER);
    await db().update(galleryGuests).set({ expiresAt: new Date(Date.now() - 1_000) }).where(eq(galleryGuests.id, guest.id));
    expect(await myGalleries.call({}, CUSTOMER)).toEqual([]);
    expect(await openGalleryWithLogin.call({ slug: shared.slug }, CUSTOMER)).toEqual({ ok: false });
  });

  it("serves authorized image bytes with a header and never falls back from explicit credentials", async () => {
    const { own, item, opened, bytes } = await imageFixture();
    const response = await imageRequest(own.slug, item.id, `Bearer ${opened.sessionToken}`);
    expect(response.status).toBe(200);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie, Authorization");
    expect(cookie.reads).toBe(0);
    cookie.token = opened.sessionToken;
    bytes.mockClear();
    for (const authorization of ["Bearer invalid", "Basic invalid", ""]) {
      expect((await imageRequest(own.slug, item.id, authorization)).status).toBe(404);
    }
    expect(bytes).not.toHaveBeenCalled();
    expect(cookie.reads).toBe(0);
    const browser = await imageRequest(own.slug, item.id);
    expect(browser.status).toBe(200);
    expect(browser.headers.get("cache-control")).toBe("private, max-age=60");
  });

  it("binds the image URL to its gallery and refuses hidden, watermarked-missing and expired content", async () => {
    const { own, item, opened, bytes } = await imageFixture();
    const authorization = `Bearer ${opened.sessionToken}`;
    expect((await imageRequest("another-gallery", item.id, authorization)).status).toBe(404);
    expect((await imageRequest(own.slug, item.id, undefined, `?token=${opened.sessionToken}`)).status).toBe(404);
    await updateGalleryItem.call({ id: item.id, canView: false }, OWNER);
    expect((await imageRequest(own.slug, item.id, authorization)).status).toBe(404);
    await updateGalleryItem.call({ id: item.id, canView: true }, OWNER);
    await updateGallery.call({ id: own.id, watermark: true }, OWNER);
    expect((await imageRequest(own.slug, item.id, authorization)).status).toBe(404);
    await updateGallery.call({ id: own.id, watermark: false, expiresAt: new Date(Date.now() - 1_000).toISOString() }, OWNER);
    expect((await imageRequest(own.slug, item.id, authorization)).status).toBe(404);
    expect(bytes).not.toHaveBeenCalled();
  });
});
