// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Collected customer feedback (MASTER.md §4.6, C8.09).
//
// The rule this file exists for is the last clause of the checklist line: an
// `AggregateRating` that never misrepresents hidden reviews.
//
//   1. Hiding a review withholds it and still counts it. Otherwise moderation
//      is rating inflation.
//   2. Rejecting drops it, because it was never a customer's opinion.
//   3. The wall shows only approved reviews, and says when there are more.
//   4. Nothing a stranger writes is public before a person reads it.
//   5. One ask per person per subject.
//   6. An incentivised review is disclosed as one.
//   7. Merge repoints; erasure keeps the rating and drops the name.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { createContact, mergeContacts } from "@/core/contacts/service";
import { updateBusiness } from "@/core/settings/service";
import {
  aggregateRating,
  listReviews,
  moderateReview,
  publishedReviews,
  replyToReview,
  requestReview,
  submitReview,
} from "@/modules/reviews/service";
import { reviews } from "@/modules/reviews/schema";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe.runIf(hasDatabase)("reviews", { timeout: 90_000 }, () => {
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

  /** Ask, answer, and hand back the review. */
  async function reviewFrom(email: string, rating: number, body = "Lovely work.") {
    const asked = await requestReview.call({ email, source: "post_order" }, OWNER);
    return submitReview.call(
      { token: asked.token, rating, body },
      ANONYMOUS,
    );
  }

  it("counts a hidden review in the rating and keeps it off the wall", async () => {
    const good = await reviewFrom("a@example.test", 5);
    const bad = await reviewFrom("b@example.test", 1, "Not for me.");
    await moderateReview.call({ id: good.id, status: "approved" }, OWNER);
    await moderateReview.call({ id: bad.id, status: "hidden" }, OWNER);

    const rating = await aggregateRating.call({ subjectType: "business" }, ANONYMOUS);
    // The whole point: withholding the one-star must not move the number to 5.
    // Moderation is an editorial choice, not a rating tool.
    expect(rating.ratingValue).toBe(3);
    expect(rating.reviewCount).toBe(2);
    expect(rating.displayedCount).toBe(1);
    expect(rating.withheld).toBe(true);

    const wall = await publishedReviews.call({ subjectType: "business" }, ANONYMOUS);
    expect(wall).toHaveLength(1);
    expect(wall[0]!.rating).toBe(5);
  });

  it("drops a rejected review from the rating entirely", async () => {
    const real = await reviewFrom("a@example.test", 4);
    const spam = await reviewFrom("b@example.test", 1, "Buy cheap watches.");
    await moderateReview.call({ id: real.id, status: "approved" }, OWNER);
    await moderateReview.call({ id: spam.id, status: "rejected" }, OWNER);

    const rating = await aggregateRating.call({ subjectType: "business" }, ANONYMOUS);
    // Rejecting says this was never a customer's opinion. Counting it would
    // let anyone with an email address move the number.
    expect(rating.ratingValue).toBe(4);
    expect(rating.reviewCount).toBe(1);
    expect(rating.withheld).toBe(false);
  });

  it("counts a review nobody has moderated yet", async () => {
    await reviewFrom("a@example.test", 5);
    await reviewFrom("b@example.test", 3);
    const rating = await aggregateRating.call({ subjectType: "business" }, ANONYMOUS);
    // Pending is "not read yet", not "did not happen". Leaving reviews
    // unmoderated must not be a way to hold the number up.
    expect(rating.reviewCount).toBe(2);
    expect(rating.ratingValue).toBe(4);
    expect(rating.displayedCount).toBe(0);
  });

  it("reports no rating rather than zero when nobody has reviewed", async () => {
    const rating = await aggregateRating.call({ subjectType: "business" }, ANONYMOUS);
    // Zero out of five is a terrible business; no reviews is a new one.
    expect(rating.ratingValue).toBeNull();
    expect(rating.reviewCount).toBe(0);
  });

  it("keeps a submitted review off the site until somebody reads it", async () => {
    const review = await reviewFrom("a@example.test", 5);
    expect(review.status).toBe("pending");
    expect(await publishedReviews.call({ subjectType: "business" }, ANONYMOUS)).toEqual([]);
    expect(await listReviews.call({ status: "pending" }, OWNER)).toHaveLength(1);
  });

  it("asks once per person per subject", async () => {
    const first = await requestReview.call(
      { email: "a@example.test", source: "post_order" },
      OWNER,
    );
    expect(first.alreadyAsked).toBe(false);
    const again = await requestReview.call(
      { email: "a@example.test", source: "post_order" },
      OWNER,
    );
    // A second email about the same purchase is the definition of nagging,
    // and re-asking must not mint a second working link.
    expect(again.alreadyAsked).toBe(true);
    expect(again.id).toBe(first.id);
    expect(again.token).toBe("");
  });

  it("refuses a second answer to one ask, and an unknown link", async () => {
    const asked = await requestReview.call({ email: "a@example.test" }, OWNER);
    await submitReview.call({ token: asked.token, rating: 5, body: "Great." }, ANONYMOUS);
    expect(
      (
        await failure(
          submitReview.call({ token: asked.token, rating: 1, body: "Again." }, ANONYMOUS),
        )
      ).message,
    ).toContain("already been sent");
    expect(
      (
        await failure(
          submitReview.call(
            { token: "not-a-real-token-at-all-x", rating: 5, body: "Hi." },
            ANONYMOUS,
          ),
        )
      ).message,
    ).toContain("did not work");
  });

  it("discloses an incentivised review as incentivised", async () => {
    const coupon = crypto.randomUUID();
    const asked = await requestReview.call(
      { email: "a@example.test", incentiveCouponId: coupon },
      OWNER,
    );
    const review = await submitReview.call(
      { token: asked.token, rating: 5, body: "Worth it." },
      ANONYMOUS,
    );
    // An incentivised review that does not say so is the kind of thing
    // regulators fine people for, so the schema refuses to store one.
    expect(review.incentiveDisclosed).toBe(true);
  });

  it("lets the owner reply once, in public", async () => {
    const review = await reviewFrom("a@example.test", 2, "Slow to arrive.");
    await moderateReview.call({ id: review.id, status: "approved" }, OWNER);
    const replied = await replyToReview.call(
      { id: review.id, body: "Sorry — the courier let us down. Refunded." },
      OWNER,
    );
    expect(replied.replyBody).toContain("Refunded");
    expect(replied.replyAt).not.toBeNull();
    const wall = await publishedReviews.call({ subjectType: "business" }, ANONYMOUS);
    expect(wall[0]!.replyBody).toContain("Refunded");
  });

  it("never puts the reviewer's contact id on the wall", async () => {
    const review = await reviewFrom("a@example.test", 5);
    await moderateReview.call({ id: review.id, status: "approved" }, OWNER);
    const wall = await publishedReviews.call({ subjectType: "business" }, ANONYMOUS);
    // Otherwise anyone can join two reviews to one person.
    expect(wall[0]).not.toHaveProperty("contactId");
  });

  it("repoints on merge and keeps the rating through erasure", async () => {
    const keep = await createContact.call(
      { name: "Rae Keep", email: "keep@example.test" },
      OWNER,
    );
    const review = await reviewFrom("drop@example.test", 5);
    const [dropId] = await db()
      .select({ id: reviews.contactId })
      .from(reviews)
      .where(eq(reviews.id, review.id));
    await mergeContacts.call(
      { survivingId: keep.id, duplicateId: dropId!.id! },
      OWNER,
    );
    const [merged] = await db().select().from(reviews).where(eq(reviews.id, review.id));
    expect(merged!.contactId).toBe(keep.id);

    const { contactPrivacySources } = await import("@/core/privacy/service");
    for (const source of contactPrivacySources().filter(
      (entry) => entry.scope === "contact.reviews",
    )) {
      await db().transaction((tx) => source.erase(tx, keep.id, { requestId: "erase-test" }));
    }
    const [erased] = await db().select().from(reviews).where(eq(reviews.id, review.id));
    // A business's public rating is not the reviewer's personal data to
    // withdraw. The name goes; the score stays.
    expect(erased!.contactId).toBeNull();
    expect(erased!.displayName).toBeNull();
    expect(erased!.rating).toBe(5);
  });
});
