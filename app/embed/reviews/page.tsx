// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { publishedReviews, aggregateRating } from "@/modules/reviews/service";
import { currentBusiness } from "@/core/settings/read";
import { siteOrigin } from "@/core/seo/origin";
import { getT } from "../../i18n";

export const dynamic = "force-dynamic";

export default async function EmbedReviewsPage() {
  const [t, business, items, rating] = await Promise.all([
    getT(),
    currentBusiness(),
    publishedReviews.call({ subjectType: "business", limit: 8 }, { kind: "anonymous" }),
    aggregateRating.call({ subjectType: "business" }, { kind: "anonymous" }),
  ]);
  const origin = siteOrigin();
  const name = business?.name ?? t("embed.thisBusiness");

  return (
    <section className="grid gap-3">
      <h1 className="text-lg font-bold tracking-tight">{t("embed.reviews.title")}</h1>
      {rating.ratingValue !== null ? (
        <p className="text-sm text-ink-muted">
          {t("reviews.rating.summary", {
            rating: rating.ratingValue,
            count: rating.reviewCount,
          })}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("embed.reviews.empty")}</p>
      ) : (
        <ul className="grid list-none gap-3 p-0">
          {items.map((review) => (
            <li key={review.id} className="border-b border-rule pb-3 text-sm last:border-0">
              {review.displayName ? <p className="font-medium">{review.displayName}</p> : null}
              {review.title ? <p className="font-semibold">{review.title}</p> : null}
              <p className="text-ink-muted">{review.body}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-ink-muted">
        <a href={origin} className="underline" target="_blank" rel="noreferrer">
          {name}
        </a>
      </p>
    </section>
  );
}
