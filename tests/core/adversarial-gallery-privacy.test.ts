// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C8.03/C8.04/C8.07: alternate delivery doors must respect gallery policy.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { dispatch } from "@/core/api/dispatch";
import { storage } from "@/adapters/storage";
import { assets } from "@/core/media/schema";
import { authorizeObjectDelivery, resolveImage } from "@/core/media/service";
import { createContact } from "@/core/contacts/service";
import { updateBusiness } from "@/core/settings/service";
import {
  addGalleryItem, buildGalleryArchive, createGallery, downloadGalleryArchive,
  downloadGalleryItem, inviteGalleryGuest, redeemGalleryGuest, removeGalleryItem,
  requestGalleryArchive, unlockGallery, updateGallery, updateGalleryItem, viewGalleryItem, galleryArchiveState, viewGallerySession,
} from "@/modules/galleries/service";
import { ANONYMOUS, closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
import { galleryArchives } from "@/modules/galleries/schema";

const storedKeys = new Set<string>();

describe.runIf(hasDatabase)("adversarial gallery delivery", () => {
  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call({ name: "Privacy proofs", country: "CA", baseCurrency: "CAD", timezone: "America/Vancouver" }, OWNER);
  });
  afterAll(async () => {
    for (const key of storedKeys) await storage().delete(key);
    await closeDb();
  });

  async function fixture(options: { watermark?: boolean; downloadLimit?: number } = {}) {
    const client = await createContact.call({ name: "Gallery client", email: "gallery-client@example.test" }, OWNER);
    const gallery = await createGallery.call({
      contactId: client.id, title: "Private proofs", access: "pin", secret: "2468",
      watermark: options.watermark ?? false,
      downloadPolicy: options.downloadLimit ? "limit_n" : "full_res",
      ...(options.downloadLimit ? { downloadLimit: options.downloadLimit } : {}),
    }, OWNER);
    const key = `test/security-${crypto.randomUUID()}.jpg`;
    const marked = `${key}.wm.webp`;
    const body = new TextEncoder().encode("PRIVATE GALLERY ORIGINAL");
    await storage().put(key, body, "image/jpeg");
    await storage().put(marked, body, "image/webp");
    storedKeys.add(key); storedKeys.add(marked);
    const [asset] = await db().insert(assets).values({
      kind: "image", storageKey: key, filename: "private.jpg", mime: "image/jpeg",
      legacyBytes: body.length, bytes: body.length, status: "ready",
      variants: { watermarked: { webp: [{ width: 800, height: 600, bytes: body.length, key: marked }] } },
    }).returning();
    const opened = await unlockGallery.call({ slug: gallery.slug, secret: "2468" }, ANONYMOUS);
    if (!opened.ok) throw new Error("Fixture gallery did not open.");
    return { gallery, asset: asset!, key, marked, token: opened.sessionToken };
  }

  async function packaged() {
    const found = await fixture();
    const item = await addGalleryItem.call({ galleryId: found.gallery.id, assetId: found.asset.id }, OWNER);
    await requestGalleryArchive.call({ sessionToken: found.token }, ANONYMOUS);
    const built = await buildGalleryArchive.call({ galleryId: found.gallery.id }, { kind: "system" });
    expect(built.state).toBe("ready");
    const allowed = await downloadGalleryArchive.call({ sessionToken: found.token }, ANONYMOUS);
    expect(allowed).not.toBeNull();
    storedKeys.add(allowed!.storageKey);
    return { ...found, item };
  }

  it("blocks the generic original and object URLs after adding a private gallery item", async () => {
    const found = await fixture({ watermark: true });
    expect(await resolveImage.call({ id: found.asset.id }, ANONYMOUS)).not.toBeNull();
    expect(await authorizeObjectDelivery.call({ key: found.key }, ANONYMOUS)).not.toBeNull();
    const item = await addGalleryItem.call({ galleryId: found.gallery.id, assetId: found.asset.id }, OWNER);
    const presented = await viewGallerySession.call({ sessionToken: found.token }, ANONYMOUS);
    expect(presented).toMatchObject({ archiveUrl: `/g/${found.gallery.slug}/archive`, items: [{
      viewUrl: `/g/${found.gallery.slug}/view/${item.id}`,
      downloadUrl: `/g/${found.gallery.slug}/download/${item.id}`,
    }] });
    expect(viewGallerySession.def.output?.safeParse({ ...presented,
      items: presented.items.map(item => ({ ...item, downloadUrl: 17 })),
    }).success).toBe(false);
    expect((await failure(downloadGalleryItem.call({ sessionToken: found.token, itemId: item.id, slug: "wrong-gallery" }, ANONYMOUS))).code)
      .toBe("not_found");
    expect(await viewGalleryItem.call({ sessionToken: found.token, itemId: item.id }, ANONYMOUS))
      .toMatchObject({ storageKey: found.marked });
    expect(await resolveImage.call({ id: found.asset.id }, ANONYMOUS)).toBeNull();
    expect(await resolveImage.call({ id: found.asset.id }, CUSTOMER)).toBeNull();
    expect(await authorizeObjectDelivery.call({ key: found.key }, ANONYMOUS)).toBeNull();
    expect(await authorizeObjectDelivery.call({ key: found.marked }, ANONYMOUS)).toBeNull();
    expect(await resolveImage.call({ id: found.asset.id }, OWNER)).not.toBeNull();
    await removeGalleryItem.call({ id: item.id }, OWNER);
    expect(await resolveImage.call({ id: found.asset.id }, ANONYMOUS)).toBeNull();
  });

  it("denies a view-only guest the shared full-gallery archive", async () => {
    const found = await packaged();
    const guest = await inviteGalleryGuest.call({
      galleryId: found.gallery.id, email: "view-only@example.test", role: "partner",
      canView: true, canDownload: false,
    }, OWNER);
    const opened = await redeemGalleryGuest.call({ token: guest.token }, ANONYMOUS);
    if (!opened.ok) throw new Error("Fixture guest did not open.");
    expect(opened).toMatchObject({ archiveUrl: null, items: [{ downloadUrl: null }] });
    expect(await downloadGalleryArchive.call({ sessionToken: found.token, slug: "wrong-gallery" }, ANONYMOUS)).toBeNull();
    expect(await downloadGalleryArchive.call({ sessionToken: opened.sessionToken }, ANONYMOUS)).toBeNull();
    expect((await failure(requestGalleryArchive.call({ sessionToken: opened.sessionToken }, ANONYMOUS))).code)
      .toBe("permission");
    expect(await downloadGalleryArchive.call({ sessionToken: found.token }, ANONYMOUS)).not.toBeNull();
  });

  it("withdraws an old archive when a packaged item's permission is revoked", async () => {
    const found = await packaged();
    await updateGalleryItem.call({ id: found.item.id, canDownload: false }, OWNER);
    expect(await downloadGalleryArchive.call({ sessionToken: found.token }, ANONYMOUS)).toBeNull();
  });

  it("withdraws an old archive when an item is removed", async () => {
    const found = await packaged();
    await removeGalleryItem.call({ id: found.item.id }, OWNER);
    expect(await downloadGalleryArchive.call({ sessionToken: found.token }, ANONYMOUS)).toBeNull();
  });

  it("withdraws an original archive when watermark policy becomes stricter", async () => {
    const found = await packaged();
    await updateGallery.call({ id: found.gallery.id, watermark: true }, OWNER);
    expect(await downloadGalleryArchive.call({ sessionToken: found.token }, ANONYMOUS)).toBeNull();
  });

  it("allows only one concurrent download when the gallery has one remaining file", async () => {
    const found = await fixture({ downloadLimit: 1 });
    const item = await addGalleryItem.call({ galleryId: found.gallery.id, assetId: found.asset.id }, OWNER);
    const other = await unlockGallery.call({ slug: found.gallery.slug, secret: "2468" }, ANONYMOUS);
    if (!other.ok) throw new Error("Fixture second session did not open.");
    const outcomes = await Promise.allSettled([found.token, other.sessionToken].map(sessionToken =>
      downloadGalleryItem.call({ sessionToken, itemId: item.id }, ANONYMOUS),
    ));
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === "rejected")).toHaveLength(1);
  });

  it("does not project byte authorization/storage keys through the public service API", async () => {
    const found = await fixture();
    const item = await addGalleryItem.call({ galleryId: found.gallery.id, assetId: found.asset.id }, OWNER);
    expect(await viewGalleryItem.call({ sessionToken: found.token, itemId: item.id }, ANONYMOUS)).not.toBeNull();
    for (const name of ["galleries.viewItem", "galleries.downloadItem", "galleries.downloadArchive"]) {
      const response = await dispatch(new Request(`https://example.test/api/v1/${name}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionToken: found.token, itemId: item.id }),
      }), name);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain(found.key);
    }
  });

  it("backfills privacy for pre-existing client-gallery assets", async () => {
    const found = await fixture();
    await addGalleryItem.call({ galleryId: found.gallery.id, assetId: found.asset.id }, OWNER);
    // Emulate the old row: the actual shipped migration must repair it.
    await db().update(assets).set({ isPrivate: false }).where(eq(assets.id, found.asset.id));
    expect(await resolveImage.call({ id: found.asset.id }, ANONYMOUS)).not.toBeNull();
    const migration = await readFile(new URL("../../db/migrations/0023_gallery_private_delivery.sql", import.meta.url), "utf8");
    await db().execute(sql.raw(migration.split("--> statement-breakpoint")[0]!));
    expect(await resolveImage.call({ id: found.asset.id }, ANONYMOUS)).toBeNull();
  });

  it("requires a rebuild for legacy archives with no trustworthy delivery snapshot", async () => {
    const found = await packaged();
    await db().update(galleryArchives).set({ deliveryHash: null }).where(eq(galleryArchives.galleryId, found.gallery.id));
    expect(await downloadGalleryArchive.call({ sessionToken: found.token }, ANONYMOUS)).toBeNull();
    expect(await galleryArchiveState.call({ sessionToken: found.token }, ANONYMOUS)).toMatchObject({ state: "failed" });
  });

  it("shares the file allowance between ZIP and individual downloads", async () => {
    const found = await fixture({ downloadLimit: 1 });
    const item = await addGalleryItem.call({ galleryId: found.gallery.id, assetId: found.asset.id }, OWNER);
    await requestGalleryArchive.call({ sessionToken: found.token }, ANONYMOUS);
    await buildGalleryArchive.call({ galleryId: found.gallery.id }, { kind: "system" });
    const archived = await downloadGalleryArchive.call({ sessionToken: found.token }, ANONYMOUS);
    expect(archived).not.toBeNull();
    storedKeys.add(archived!.storageKey);
    expect((await failure(downloadGalleryItem.call({ sessionToken: found.token, itemId: item.id }, ANONYMOUS))).code).toBe("permission");
    expect(await downloadGalleryArchive.call({ sessionToken: found.token }, ANONYMOUS)).toBeNull();
  });
});
