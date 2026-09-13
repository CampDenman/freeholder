// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.04: interrupted/resumed Asset ingest → gallery proof/select → print
// order AND social package → publish → referral. Social publish uses adapter
// doubles (mocked OAuth/network). The public /capture/[token] page is the
// paired Playwright file tests/browser/c11-04-capture.spec.ts — that Asset is
// a second ingest, not this print/publish chain. Live network publish is not
// claimed.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { ready } from "@/core/runtime";
import { assets } from "@/core/media/schema";
import {
  appendCaptureChunk,
  assembleCapture,
  confirmCapture,
  createCaptureSession,
  grantCapturePermission,
} from "@/core/media/capture";
import { createContact } from "@/core/contacts/service";
import { updateBusiness } from "@/core/settings/service";
import { resolveContact } from "@/core/contacts/service";
import {
  addGalleryItem,
  addGalleryItemToCart,
  addGalleryPriceSheetItem,
  createGallery,
  setGallerySelection,
  unlockGallery,
} from "@/modules/galleries/service";
import {
  applyVariantMatrix,
  checkoutCart,
  createPriceList,
  createProduct,
  createShippingMethod,
  createShippingZone,
  getOrCreateCart,
  getProductVariants,
  payOrder,
  setPriceListEntry,
} from "@/modules/catalog/service";
import { createLocationService } from "@/core/locations/service";
import { enableInventory, recordStockMovement } from "@/modules/catalog/service";
import { createPayment, settlePayment } from "@/modules/invoicing/invoice-service";
import {
  beginOAuth,
  completeOAuth,
  composePackage,
  createVariants,
  publicationCalendar,
  reviewProfile,
  reviewVariant,
  runPublication,
  schedulePublications,
  setPolicy,
} from "@/modules/social/service";
import {
  claimTouches,
  issueCode,
  recordTouch,
  saveProgram,
} from "@/modules/referrals/service";
import {
  ANONYMOUS,
  closeDb,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

const changedEnvironment = new Map<string, string | undefined>();
const downloadSocialMedia = vi.hoisted(() => vi.fn());

vi.mock("@/adapters/social/media", () => ({ downloadSocialMedia }));

function environment(values: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(values)) {
    if (!changedEnvironment.has(name)) changedEnvironment.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetEnvForTests();
}

function stateFrom(authorizationUrl: string): string {
  return new URL(authorizationUrl).searchParams.get("state")!;
}

async function pngBytes(): Promise<Uint8Array> {
  const buffer = await sharp({
    create: { width: 40, height: 40, channels: 3, background: { r: 80, g: 20, b: 20 } },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buffer);
}

function api(png: Uint8Array, publishedId = "net-1") {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "POST" && url.includes("token")) {
      return new Response(
        JSON.stringify({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 60 * 60 * 24 * 30,
          token_type: "Bearer",
          scope: "instagram_business_basic instagram_business_content_publish",
        }),
        { status: 200 },
      );
    }
    if (method === "POST") {
      return new Response(JSON.stringify({ id: publishedId, url: "https://ig.example/p/1" }), {
        status: 200,
      });
    }
    return new Response(JSON.stringify({ id: "ig-1", name: "Harbour" }), { status: 200 });
  });
}

describe.runIf(hasDatabase)("C11.04 gallery social referral", { timeout: 90_000 }, () => {
  let png: Uint8Array;

  beforeAll(async () => {
    await ready();
    png = await pngBytes();
  }, 180_000);

  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values({
      id: OWNER.userId,
      email: "owner@example.test",
      role: "owner",
    });
    downloadSocialMedia.mockResolvedValue(png);
    await updateBusiness.call(
      {
        name: "Hearth & Pine",
        country: "CA",
        baseCurrency: "CAD",
        timezone: "America/Vancouver",
      },
      OWNER,
    );
    environment({
      APP_URL: "https://freeholder.example",
      META_OAUTH_CLIENT_ID: "meta-id",
      META_OAUTH_CLIENT_SECRET: "meta-secret",
    });
  }, 60_000);

  afterEach(() => {
    for (const [name, value] of changedEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    changedEnvironment.clear();
    resetEnvForTests();
    vi.unstubAllGlobals();
  });

  afterAll(closeDb);

  it("ingests an interrupted Asset, proofs it, sells a print, publishes once and attributes a referral", async () => {
    const capture = await createCaptureSession.call({ source: "screen" }, OWNER);
    await grantCapturePermission.call({ id: capture.id }, OWNER);
    const split = Math.max(1, Math.floor(png.byteLength / 2));
    await appendCaptureChunk.call(
      { id: capture.id, sequence: 0, contentType: "image/png", bytes: png.subarray(0, split) },
      OWNER,
    );
    await appendCaptureChunk.call(
      { id: capture.id, sequence: 1, contentType: "image/png", bytes: png.subarray(split) },
      OWNER,
    );
    const assembled = await assembleCapture.call(
      { id: capture.id, filename: "harbour.png", expectedChunks: 2 },
      OWNER,
    );
    expect(assembled.session.status).toBe("preview");
    const confirmed = await confirmCapture.call({ id: capture.id }, OWNER);
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.assetId).toBeTruthy();
    const [asset] = await db().select().from(assets).where(eq(assets.id, confirmed.assetId!));
    expect(asset).toBeTruthy();

    const client = await createContact.call(
      { name: "Rae Lane", email: "client-c11@example.test" },
      OWNER,
    );
    const gallery = await createGallery.call(
      { contactId: client.id, title: "Coastal proofs", access: "pin", secret: "2468" },
      OWNER,
    );
    const item = await addGalleryItem.call({ galleryId: gallery.id, assetId: asset!.id }, OWNER);
    const session = await unlockGallery.call({ slug: gallery.slug, secret: "2468" }, ANONYMOUS);
    expect(session.ok).toBe(true);
    if (!session.ok) throw new Error("expected the gallery to open");
    await setGallerySelection.call(
      { sessionToken: session.sessionToken, itemId: item.id, kind: "select" },
      ANONYMOUS,
    );

    const studio = await createLocationService.call(
      { name: "Studio", slug: "c11-04-studio", city: "Courtenay", country: "CA" },
      OWNER,
    );
    const print = await createProduct.call({ name: "8x10 print", slug: "c11-8x10", kind: "physical" }, OWNER);
    const updated = await applyVariantMatrix.call(
      { productId: print.id, expectedVersion: print.version },
      OWNER,
    );
    const variant = (await getProductVariants.call({ productId: updated.id }, OWNER)).variants[0]!;
    const list = await createPriceList.call({ name: "CAD prints", currency: "CAD", kind: "retail" }, OWNER);
    await setPriceListEntry.call({ priceListId: list.id, variantId: variant.id, amount: "25.00" }, OWNER);
    const stock = await enableInventory.call({ variantId: variant.id, locationId: studio.id }, OWNER);
    await recordStockMovement.call({ itemId: stock.id, delta: 3, reason: "receipt" }, OWNER);
    const zone = await createShippingZone.call(
      { name: "World", countries: [], regions: [], postalPatterns: [] },
      OWNER,
    );
    await createShippingMethod.call(
      { zoneId: zone.id, name: "Parcel", kind: "flat", currency: "CAD", amount: "5.00" },
      OWNER,
    );
    await addGalleryPriceSheetItem.call({ galleryId: gallery.id, variantId: variant.id }, OWNER);
    const basket = await getOrCreateCart.call({ contactId: client.id, currency: "CAD" }, OWNER);
    await addGalleryItemToCart.call(
      { sessionToken: session.sessionToken, itemId: item.id, variantId: variant.id, cartId: basket.cart.id },
      ANONYMOUS,
    );
    const placed = await checkoutCart.call(
      {
        cartId: basket.cart.id,
        contactId: client.id,
        idempotencyKey: `c11-04-${client.id}`,
        acceptedTerms: true,
        shippingAddress: { country: "CA", city: "Courtenay" },
      },
      OWNER,
    );
    const payment = await createPayment.call(
      {
        invoiceId: placed.order.invoiceId!,
        provider: "manual",
        method: "bank_transfer",
        amountMinor: placed.order.totalMinor,
        idempotencyKey: `pay-${placed.order.id}`,
      },
      OWNER,
    );
    await settlePayment.call({ id: payment.id, providerRef: `manual:${placed.order.id}` }, OWNER);
    await payOrder.call({ id: placed.order.id }, OWNER);

    const begun = await beginOAuth.call({ provider: "instagram" }, OWNER);
    vi.stubGlobal("fetch", api(png, "net-c11"));
    const profile = await completeOAuth.call(
      { provider: "instagram", state: stateFrom(begun.authorizationUrl), code: "one-use" },
      OWNER,
    );
    await reviewProfile.call({ id: profile.id, approved: true }, OWNER);
    await setPolicy.call(
      {
        id: profile.id,
        allowRead: true,
        allowRespond: false,
        allowPublish: true,
        approvalPolicy: "required",
      },
      OWNER,
    );
    const pack = await composePackage.call(
      { body: "Harbour at dusk #harbour", assetIds: [asset!.id] },
      OWNER,
    );
    const [variantPost] = await createVariants.call(
      { packageId: pack.id, profileIds: [profile.id] },
      OWNER,
    );
    await reviewVariant.call({ id: variantPost!.id, approved: true }, OWNER);
    const [publication] = await schedulePublications.call(
      { variantIds: [variantPost!.id], publishAt: "2020-01-01T00:00:00.000Z" },
      OWNER,
    );
    await runPublication(publication!.id);
    const published = (await publicationCalendar.call({}, OWNER)).filter((row) => row.status === "published");
    expect(published).toHaveLength(1);

    const referral = await saveProgram.call(
      { name: "Word of mouth", status: "active", cookieWindowDays: 30 },
      OWNER,
    );
    const referrer = await resolveContact.call({ email: "ref-c11@example.test", name: "Ref" }, OWNER);
    await issueCode.call({ programId: referral.id, contactId: referrer.contact.id, code: "C11ROCK" }, OWNER);
    await recordTouch.call({ code: "C11ROCK", anonId: "visitor-c11" }, ANONYMOUS);
    const claimed = await claimTouches.call(
      { anonId: "visitor-c11", contactId: client.id },
      { kind: "system" },
    );
    expect(claimed.claimed).toBe(1);
  });
});
