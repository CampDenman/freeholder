// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.14: pages, forms, popups, segments and saved views recover with the
// same guarantees notes and tasks proved in record-trash.test.ts — original
// rows, held purge, no erasure resurrection, fail-closed consumers.
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { createContact } from "@/core/contacts/service";
import { saveView, setDefaultView, defaultView, listViews, removeView, restoreView, purgeView, purgeExpiredViews } from "@/core/views/service";
import { savedViews } from "@/core/views/schema";
import { saveSegment, removeSegment, restoreSegment, purgeSegment, purgeExpiredSegments, captureSegment, contactInSegment } from "@/core/segments/service";
import { segments, segmentMembers } from "@/core/segments/schema";
import { createDataRequest, addRetentionException, removeRetentionException, verifyDataRequest, fulfillDataRequest } from "@/core/privacy/service";
import { forms, formSubmissions } from "@/modules/forms/schema";
import { issueStamp, STAMP_FIELD } from "@/modules/forms/antispam";
import { createForm, listForms, removeForm, restoreForm, purgeForm, purgeExpiredForms, submitForm, listSubmissions, updateForm } from "@/modules/forms/service";
import { popups, popupEvents } from "@/modules/popups/schema";
import { savePopup, setPopupStatus, removePopup, restorePopup, purgePopup, purgeExpiredPopups, decidePopup, recordPopupEvent } from "@/modules/popups/service";
import { contentPreviewLinks, contentRevisions, pages } from "@/modules/cms/schema";
import { createPage, publishPage, resolvePage, getPage, listPages, removePage, restorePage, purgePage, publishedPaths, updatePage } from "@/modules/cms/service";
import { createPreviewLink } from "@/modules/cms/lifecycle";
import { querySearch } from "@/core/search/service";
import { applyVariantMatrix, createPriceList, createProduct, getProductVariants, resolvePrice, setPriceListEntry } from "@/modules/catalog/service";
import { stopJobs } from "@/core/jobs";
import { OWNER, STAFF, ANONYMOUS, failure, hasDatabase, truncateSpine, closeDb } from "../helpers/spine";

const TOKEN = "trashfam";

describe.runIf(hasDatabase)("page, form, popup, segment and saved-view trash (C11.14)", () => {
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values([
      { id: OWNER.userId, email: "owner@example.test", role: "owner" },
      { id: STAFF.userId, email: "staff@example.test", role: "staff" },
    ]);
  });
  afterAll(async () => { await stopJobs(); await closeDb(); });

  async function page() {
    return createPage.call({
      slug: `${TOKEN}-${randomUUID().slice(0, 8)}`,
      title: `${TOKEN} studio page`,
      blocks: [{ id: "h1", type: "heading", props: { text: `${TOKEN} studio page`, level: 1, align: "start" } }],
    }, OWNER);
  }

  /** Values a real browser would post: the antispam stamp proves a human pace. */
  function human(values: Record<string, unknown>) {
    return { ...values, [STAMP_FIELD]: issueStamp(new Date(Date.now() - 20_000)) };
  }

  it("hides trashed pages from the public site, sitemap, admin reads and search until restored", async () => {
    const created = await page();
    await publishPage.call({ id: created.id, published: true }, OWNER);
    await updatePage.call({ id: created.id, title: `${TOKEN} edited title` }, OWNER);
    const slug = created.slug;
    expect((await resolvePage.call({ slug }, ANONYMOUS))?.id).toBe(created.id);
    expect((await publishedPaths.call({ locale: "en" }, ANONYMOUS)).some(p => p.slug === slug)).toBe(true);
    expect((await querySearch.call({ q: TOKEN }, OWNER)).some(hit => hit.kind === "page")).toBe(true);

    await removePage.call({ id: created.id }, OWNER);
    expect(await resolvePage.call({ slug }, ANONYMOUS)).toBeNull();
    expect((await publishedPaths.call({ locale: "en" }, ANONYMOUS)).some(p => p.slug === slug)).toBe(false);
    expect(await querySearch.call({ q: TOKEN }, OWNER)).toEqual([]);
    await expect(getPage.call({ id: created.id }, OWNER)).rejects.toMatchObject({ code: "not_found" });
    await expect(updatePage.call({ id: created.id, title: "Nope" }, OWNER)).rejects.toMatchObject({ code: "not_found" });
    await expect(publishPage.call({ id: created.id, published: false }, OWNER)).rejects.toMatchObject({ code: "not_found" });
    expect((await listPages.call({}, OWNER))).toHaveLength(0);
    expect((await listPages.call({ trashedOnly: true }, OWNER))[0]?.id).toBe(created.id);

    const restored = await restorePage.call({ id: created.id }, OWNER);
    expect(restored).toMatchObject({ id: created.id, slug, status: "published", version: created.version + 2 });
    expect((await resolvePage.call({ slug }, ANONYMOUS))?.id).toBe(created.id);
    // create + autosave + publish, all still attached to the original row.
    expect((await listRevisionsOf(created.id))).toHaveLength(3);
  });

  it("reserves the page slug through trash and purges the page with everything that exists only for it", async () => {
    const created = await page();
    await createPreviewLink.call({ pageId: created.id }, OWNER);
    await removePage.call({ id: created.id }, OWNER);
    // The original row keeps the slug, so nothing else can take the address
    // out from under a future restore.
    await expect(createPage.call({ slug: created.slug, title: "Squatter" }, OWNER)).rejects.toMatchObject({ code: "conflict" });

    await purgePage.call({ id: created.id, confirmation: "PURGE" }, OWNER);
    expect(await db().select().from(pages).where(eq(pages.id, created.id))).toHaveLength(0);
    expect(await db().select().from(contentRevisions).where(eq(contentRevisions.subjectId, created.id))).toHaveLength(0);
    expect(await db().select().from(contentPreviewLinks).where(eq(contentPreviewLinks.pageId, created.id))).toHaveLength(0);
    await expect(restorePage.call({ id: created.id }, OWNER)).rejects.toMatchObject({ code: "not_found" });
    // Purge released the slug.
    expect((await createPage.call({ slug: created.slug, title: "Squatter" }, OWNER)).slug).toBe(created.slug);
  });

  it("keeps form submissions live while the definition is in trash", async () => {
    const form = await createForm.call({
      slug: `${TOKEN}-${randomUUID().slice(0, 8)}`,
      name: `${TOKEN} enquiry`,
      fields: [{ key: "email", label: "Email", kind: "email", required: true }],
    }, OWNER);
    const submitted = await submitForm.call({ slug: form.slug, values: human({ email: `${TOKEN}@example.test` }) }, ANONYMOUS);
    expect(submitted.ok).toBe(true);

    await removeForm.call({ id: form.id }, OWNER);
    expect((await listForms.call({}, OWNER))).toHaveLength(0);
    expect(await restoreForm.call({ id: form.id }, OWNER).then(() => true)).toBe(true);
    await removeForm.call({ id: form.id }, OWNER);
    // The definition is gone from every ordinary surface…
    expect((await listForms.call({ trashedOnly: true }, OWNER))[0]?.id).toBe(form.id);
    await expect(updateForm.call({ id: form.id, name: "Nope" }, OWNER)).rejects.toMatchObject({ code: "not_found" });
    // …but the submissions are evidence, and they stay live and reviewable.
    expect((await listSubmissions.call({ formId: form.id }, OWNER))).toHaveLength(1);
    expect((await db().select().from(formSubmissions).where(eq(formSubmissions.formId, form.id)))).toHaveLength(1);
    await expect(submitForm.call({ slug: form.slug, values: human({ email: "second@example.test" }) }, ANONYMOUS))
      .rejects.toMatchObject({ code: "not_found" });
  });

  it("gates form purge behind typed confirmation, step-up and the thirty-day sweep", async () => {
    const form = await createForm.call({ slug: `${TOKEN}-${randomUUID().slice(0, 8)}`, name: `${TOKEN} sweep` }, OWNER);
    await removeForm.call({ id: form.id }, OWNER);
    await expect(purgeForm.call({ id: form.id, confirmation: "DELETE" }, OWNER)).rejects.toMatchObject({ code: "validation" });
    const unverified = { ...OWNER, security: { twoFactorRequired: true, twoFactorEnrolled: true, twoFactorVerified: true, stepUpValid: false } };
    await expect(purgeForm.call({ id: form.id, confirmation: "PURGE" }, unverified)).rejects.toMatchObject({ code: "step_up_required" });
    // Fresh trash survives the sweep; backdated trash is reclaimed.
    expect(await purgeExpiredForms.call({}, { kind: "system" })).toEqual({ purged: 0 });
    await db().update(forms).set({ trashedAt: new Date(Date.now() - 31 * 86_400_000) }).where(eq(forms.id, form.id));
    expect(await purgeExpiredForms.call({}, { kind: "system" })).toEqual({ purged: 1 });
    expect(await db().select().from(forms).where(eq(forms.id, form.id))).toHaveLength(0);
  });

  it("keeps a trashed popup out of every live surface until restored", async () => {
    const popup = await savePopup.call({ slug: `${TOKEN}-${randomUUID().slice(0, 8)}`, name: `${TOKEN} modal`, title: `${TOKEN} modal` }, OWNER);
    await setPopupStatus.call({ id: popup.id, status: "active" }, OWNER);
    expect((await decidePopup.call({ path: "/", locale: "en" }, ANONYMOUS))?.id).toBe(popup.id);

    await removePopup.call({ id: popup.id }, OWNER);
    expect(await decidePopup.call({ path: "/", locale: "en" }, ANONYMOUS)).toBeNull();
    await expect(recordPopupEvent.call({ popupId: popup.id, kind: "shown" }, ANONYMOUS)).rejects.toMatchObject({ code: "not_found" });
    await setPopupStatus.call({ id: popup.id, status: "active" }, OWNER).then(
      () => { throw new Error("expected setStatus on a trashed popup to fail"); },
      (error) => expect(error).toMatchObject({ code: "not_found" }),
    );
    expect((await restorePopup.call({ id: popup.id }, OWNER)).id).toBe(popup.id);
    expect((await decidePopup.call({ path: "/", locale: "en" }, ANONYMOUS))?.id).toBe(popup.id);
  });

  it("blocks purging forms, popups and segments while a contact with held data is attached, manual and swept", async () => {
    const contact = await createContact.call({ name: "Held person", email: `${TOKEN}-held@example.test` }, OWNER);
    const request = await createDataRequest.call({ contactId: contact.id, request: { kind: "erasure" } }, OWNER);
    const heldScopes = ["forms.submissions", "contact.popups", "contact.segments"];
    const holds = [];
    for (const scope of heldScopes) {
      holds.push(await addRetentionException.call({ dataRequestId: request.id, scope, reason: "legal_claim", legalBasis: "Documented active dispute" }, OWNER));
    }

    // A form with a submission from the held contact.
    const form = await createForm.call({
      slug: `${TOKEN}-${randomUUID().slice(0, 8)}`,
      name: `${TOKEN} held form`,
      fields: [{ key: "email", label: "Email", kind: "email", required: true }],
    }, OWNER);
    await submitForm.call({ slug: form.slug, values: human({ email: `${TOKEN}-held@example.test` }) }, ANONYMOUS);
    // A popup the held contact saw.
    const popup = await savePopup.call({ slug: `${TOKEN}-${randomUUID().slice(0, 8)}`, name: `${TOKEN} held popup`, title: `${TOKEN} held popup` }, OWNER);
    await db().insert(popupEvents).values({ popupId: popup.id, contactId: contact.id, kind: "shown" });
    // A segment capturing the held contact.
    const segment = await saveSegment.call({ name: `${TOKEN} held segment`, definition: { match: "all", rules: [{ field: "contact.email", op: "is", value: `${TOKEN}-held@example.test` }] } }, OWNER);
    await captureSegment.call({ id: segment.id }, OWNER);

    await removeForm.call({ id: form.id }, OWNER);
    await removePopup.call({ id: popup.id }, OWNER);
    await removeSegment.call({ id: segment.id }, OWNER);
    const expired = new Date(Date.now() - 31 * 86_400_000);
    await db().update(forms).set({ trashedAt: expired }).where(eq(forms.id, form.id));
    await db().update(popups).set({ trashedAt: expired }).where(eq(popups.id, popup.id));
    await db().update(segments).set({ trashedAt: expired }).where(eq(segments.id, segment.id));

    await expect(purgeForm.call({ id: form.id, confirmation: "PURGE" }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    await expect(purgePopup.call({ id: popup.id, confirmation: "PURGE" }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    await expect(purgeSegment.call({ id: segment.id, confirmation: "PURGE" }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    expect(await purgeExpiredForms.call({}, { kind: "system" })).toEqual({ purged: 0 });
    expect(await purgeExpiredPopups.call({}, { kind: "system" })).toEqual({ purged: 0 });
    expect(await purgeExpiredSegments.call({}, { kind: "system" })).toEqual({ purged: 0 });

    for (const hold of holds) await removeRetentionException.call({ id: hold.id }, OWNER);
    expect(await purgeExpiredForms.call({}, { kind: "system" })).toEqual({ purged: 1 });
    expect(await purgeExpiredPopups.call({}, { kind: "system" })).toEqual({ purged: 1 });
    expect(await purgeExpiredSegments.call({}, { kind: "system" })).toEqual({ purged: 1 });
  });

  it("refuses to purge a segment that another surface still wires in", async () => {
    const segment = await saveSegment.call({ name: `${TOKEN} wired`, definition: { match: "all", rules: [{ field: "contact.country", op: "is", value: "CA" }] } }, OWNER);
    await savePopup.call({ slug: `${TOKEN}-wired-popup`, name: "Wired popup", title: "Wired popup", audience: "inSegment", segmentId: segment.id }, OWNER);
    await removeSegment.call({ id: segment.id }, OWNER);
    const refused = await failure(purgeSegment.call({ id: segment.id, confirmation: "PURGE" }, OWNER));
    expect(refused.code).toBe("conflict");
    expect(refused.message).toContain("wired into another surface");
    // Restoring is always available; purge waits for the wiring to go.
    expect((await restoreSegment.call({ id: segment.id }, OWNER)).id).toBe(segment.id);
  });

  it("fails closed everywhere a trashed segment was the answer", async () => {
    const member = await createContact.call({ name: "Segment member", email: `${TOKEN}-member@example.test`, country: "CA" }, OWNER);
    const outsider = await createContact.call({ name: "Segment outsider", email: `${TOKEN}-outsider@example.test`, country: "US" }, OWNER);
    const segment = await saveSegment.call({ name: `${TOKEN} audience`, definition: { match: "all", rules: [{ field: "contact.country", op: "is", value: "CA" }] } }, OWNER);

    // A contract price list that only the segment earns.
    const product = await createProduct.call({ name: `${TOKEN} print`, slug: `${TOKEN}-print`, kind: "physical" }, OWNER);
    const variant = (await getProductVariants.call({ productId: (await applyVariantMatrix.call({ productId: product.id, expectedVersion: product.version }, OWNER)).id }, OWNER)).variants[0]!;
    const retail = await createPriceList.call({ name: `${TOKEN} retail`, currency: "CAD", kind: "retail", priority: 1 }, OWNER);
    const memberList = await createPriceList.call({ name: `${TOKEN} member`, currency: "CAD", kind: "member", segmentId: segment.id, priority: 5 }, OWNER);
    await setPriceListEntry.call({ priceListId: retail.id, variantId: variant.id, amount: "80.00" }, OWNER);
    await setPriceListEntry.call({ priceListId: memberList.id, variantId: variant.id, amount: "60.00" }, OWNER);
    expect((await resolvePrice.call({ variantId: variant.id, currency: "CAD", contactId: member.id }, OWNER)).amountMinor).toBe(6000);
    expect((await resolvePrice.call({ variantId: variant.id, currency: "CAD", contactId: outsider.id }, OWNER)).amountMinor).toBe(8000);

    // An inSegment popup and a notInSegment popup — the widening check. For
    // an anonymous visitor the notInSegment popup is the one that answers
    // today; once the segment is trashed that answer must not widen to
    // "everyone".
    const inside = await savePopup.call({ slug: `${TOKEN}-in`, name: "In popup", title: "In popup", audience: "inSegment", segmentId: segment.id }, OWNER);
    const outside = await savePopup.call({ slug: `${TOKEN}-out`, name: "Out popup", title: "Out popup", audience: "notInSegment", segmentId: segment.id }, OWNER);
    for (const popup of [inside, outside]) {
      await setPopupStatus.call({ id: popup.id, status: "active" }, OWNER);
    }
    expect((await decidePopup.call({ path: "/", locale: "en" }, ANONYMOUS))?.id).toBe(outside.id);

    await removeSegment.call({ id: segment.id }, OWNER);
    await expect(contactInSegment.call({ id: segment.id, contactId: member.id }, OWNER)).rejects.toMatchObject({ code: "not_found" });
    // The price list stops applying: no concession without an answerable list.
    expect((await resolvePrice.call({ variantId: variant.id, currency: "CAD", contactId: member.id }, OWNER)).amountMinor).toBe(8000);
    // inSegment does not show…
    expect(await decidePopup.call({ path: "/", locale: "en" }, ANONYMOUS)).toBeNull();

    await restoreSegment.call({ id: segment.id }, OWNER);
    expect((await resolvePrice.call({ variantId: variant.id, currency: "CAD", contactId: member.id }, OWNER)).amountMinor).toBe(6000);
    expect((await decidePopup.call({ path: "/", locale: "en" }, ANONYMOUS))?.id).toBe(outside.id);
  });

  it("does not resurrect erased personal data through restore", async () => {
    const contact = await createContact.call({ name: "Erased person", email: `${TOKEN}-erased@example.test`, country: "CA" }, OWNER);

    // Form: definition trashed, then the submitter is erased.
    const form = await createForm.call({
      slug: `${TOKEN}-${randomUUID().slice(0, 8)}`,
      name: `${TOKEN} erased form`,
      fields: [{ key: "email", label: "Email", kind: "email", required: true }],
    }, OWNER);
    await submitForm.call({ slug: form.slug, values: human({ email: `${TOKEN}-erased@example.test` }) }, ANONYMOUS);
    await removeForm.call({ id: form.id }, OWNER);

    // Segment: membership frozen, then the member is erased.
    const segment = await saveSegment.call({ name: `${TOKEN} erased segment`, definition: { match: "all", rules: [{ field: "contact.country", op: "is", value: "CA" }] } }, OWNER);
    await captureSegment.call({ id: segment.id }, OWNER);
    await removeSegment.call({ id: segment.id }, OWNER);

    // Popup: an event recorded, then the visitor is erased.
    const popup = await savePopup.call({ slug: `${TOKEN}-${randomUUID().slice(0, 8)}`, name: `${TOKEN} erased popup`, title: `${TOKEN} erased popup` }, OWNER);
    await db().insert(popupEvents).values({ popupId: popup.id, contactId: contact.id, kind: "shown" });
    await removePopup.call({ id: popup.id }, OWNER);

    const request = await createDataRequest.call({ contactId: contact.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Verified requester" }, OWNER);
    await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);

    // Restoring brings the records back — with the erased data still gone.
    await expect(restoreForm.call({ id: form.id }, OWNER)).resolves.toMatchObject({ id: form.id });
    const [submission] = await db().select().from(formSubmissions).where(eq(formSubmissions.formId, form.id));
    expect(submission).toMatchObject({ data: {}, sourceUrl: null });
    expect(await restoreSegment.call({ id: segment.id }, OWNER)).toMatchObject({ id: segment.id });
    expect(await db().select().from(segmentMembers).where(eq(segmentMembers.contactId, contact.id))).toHaveLength(0);
    await expect(restorePopup.call({ id: popup.id }, OWNER)).resolves.toMatchObject({ id: popup.id });
    const [event] = await db().select().from(popupEvents).where(eq(popupEvents.popupId, popup.id));
    expect(event).toMatchObject({ contactId: null });
  });

  it("keeps saved-view trash personal to its owner", async () => {
    const view = await saveView.call({ entity: "contacts", name: `${TOKEN} mine`, isDefault: true }, OWNER);
    await removeView.call({ id: view.id }, OWNER);
    // The owner sees it in trash; a colleague sees nothing of it, and cannot
    // restore or purge it.
    expect((await listViews.call({ trashedOnly: true }, OWNER))[0]?.id).toBe(view.id);
    expect(await listViews.call({ trashedOnly: true }, STAFF)).toEqual([]);
    await expect(restoreView.call({ id: view.id }, STAFF)).rejects.toMatchObject({ code: "not_found" });
    await expect(purgeView.call({ id: view.id, confirmation: "PURGE" }, STAFF)).rejects.toMatchObject({ code: "conflict" });
    expect(await defaultView.call({ entity: "contacts" }, OWNER)).toBeNull();
    await expect(setDefaultView.call({ id: view.id, entity: "contacts" }, OWNER)).rejects.toMatchObject({ code: "not_found" });
    // Restore returns it — default flag and all — because the row never left.
    expect((await restoreView.call({ id: view.id }, OWNER)).id).toBe(view.id);
    expect((await defaultView.call({ entity: "contacts" }, OWNER))?.id).toBe(view.id);
  });

  it("paginates saved-view trash without repeats and purges at most 500 rows per sweep", async () => {
    const views = await Promise.all(Array.from({ length: 52 }, (_, index) =>
      saveView.call({ entity: "contacts", name: `${TOKEN} batch ${index}` }, OWNER)));
    for (const view of views) await removeView.call({ id: view.id }, OWNER);
    const first = await listViews.call({ trashedOnly: true }, OWNER);
    expect(first).toHaveLength(52);
    for (const view of views.slice(0, 502)) {
      await db().update(savedViews).set({ trashedAt: new Date(Date.now() - 31 * 86_400_000) }).where(eq(savedViews.id, view.id));
    }
    await db().insert(savedViews).values(Array.from({ length: 502 }, (_, index) => ({
      entity: "contacts",
      name: `${TOKEN} swept ${index}`,
      ownerUserId: OWNER.userId,
      trashedAt: new Date(Date.now() - 31 * 86_400_000),
    })));
    expect(await purgeExpiredViews.call({}, { kind: "system" })).toEqual({ purged: 500 });
    expect(await purgeExpiredViews.call({}, { kind: "system" })).toEqual({ purged: 54 });
    expect(await purgeExpiredViews.call({}, { kind: "system" })).toEqual({ purged: 0 });
  });
});

async function listRevisionsOf(pageId: string) {
  return db().select().from(contentRevisions)
    .where(eq(contentRevisions.subjectType, "page"))
    .then(rows => rows.filter(row => row.subjectId === pageId));
}
