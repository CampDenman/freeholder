// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The review wall (MASTER.md §4.6, C8.09).
import { z } from "zod";
import { defineBlock } from "@/modules/cms/blocks/types";

const stars = (rating: number) => "★★★★★".slice(0, rating) + "☆☆☆☆☆".slice(0, 5 - rating);

export const reviewWall = defineBlock({
  type: "reviewWall",
  labelKey: "cms.block.reviewWall",
  contexts: ["page"],
  schema: z.object({
    subjectType: z.enum(["business", "product", "service"]).default("business"),
    subjectId: z.string().uuid().nullish(),
    location: z.string().trim().max(60).optional(),
    limit: z.number().int().min(1).max(50).default(12),
  }),
  starter: () => ({ subjectType: "business" as const, limit: 12 }),
  resolve: async (props) => {
    const { publishedReviews, aggregateRating } = await import("./service");
    const anonymous = { kind: "anonymous" } as const;
    const [items, rating] = await Promise.all([
      publishedReviews.call(
        {
          subjectType: props.subjectType,
          subjectId: props.subjectId ?? null,
          location: props.location,
          limit: props.limit,
        },
        anonymous,
      ),
      aggregateRating.call(
        { subjectType: props.subjectType, subjectId: props.subjectId ?? null },
        anonymous,
      ),
    ]);
    return { items, rating };
  },
  render: ({ resolved, ctx }) => {
    if (!resolved || resolved.items.length === 0) return null;
    const { items, rating } = resolved;
    return (
      <section className="grid gap-4">
        {rating.ratingValue !== null ? (
          <p className="text-sm text-ink-muted">
            <span aria-hidden="true">{stars(Math.round(rating.ratingValue))}</span>{" "}
            <span>
              {ctx.t("reviews.rating.summary", {
                rating: rating.ratingValue,
                count: rating.reviewCount,
              })}
            </span>
            {/*
              The count above includes reviews the owner has withheld, because
              the rating must not improve by hiding people. Saying so is the
              honest half of that rule: a reader can see the wall is shorter
              than the number it is averaged from.
            */}
            {rating.withheld ? (
              <span> — {ctx.t("reviews.rating.shown", { count: items.length })}</span>
            ) : null}
          </p>
        ) : null}
        <ul className="grid list-none gap-4 p-0">
          {items.map((review) => (
            <li key={review.id} className="border-b border-rule pb-4 last:border-0">
              <p className="text-sm">
                <span aria-hidden="true">{stars(review.rating)}</span>
                <span className="sr-only">
                  {ctx.t("reviews.rating.outOf", { rating: review.rating })}
                </span>
                {review.displayName ? (
                  <span className="ms-2 font-medium text-ink">{review.displayName}</span>
                ) : null}
              </p>
              {review.title ? <p className="mt-1 font-semibold">{review.title}</p> : null}
              <p className="mt-1 text-sm text-ink-muted">{review.body}</p>
              {review.incentiveDisclosed ? (
                <p className="mt-1 text-xs text-ink-muted">
                  {ctx.t("reviews.incentive.disclosure")}
                </p>
              ) : null}
              {review.replyBody ? (
                <p className="mt-2 border-s-2 border-rule ps-3 text-sm text-ink-muted">
                  {review.replyBody}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    );
  },
});

export default [reviewWall];
