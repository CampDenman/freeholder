// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Collected customer feedback (C8.09, C11.09 F04, MASTER.md §4.6).
//
// The rating rule is the whole point of this screen: hiding withholds a
// review from the wall and still counts it, so moderation can never quietly
// improve the number. The copy next to Hide says so, because a button that
// only the service understands is how an owner learns the rule too late.
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Field, Input, Pill, Select, type Tone } from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { formatDateTime } from "@/core/i18n";
import { hasModuleAccess } from "@/core/service";
import {
  aggregateRating,
  listReviews,
  REVIEW_SOURCES,
  REVIEW_STATES,
} from "@/modules/reviews/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import {
  moderateReviewAction,
  replyToReviewAction,
  requestReviewAction,
} from "../../review-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const STATUS_TONES: Record<(typeof REVIEW_STATES)[number], Tone> = {
  pending: "warning",
  approved: "success",
  hidden: "neutral",
  rejected: "danger",
};

const REQUEST_SOURCES = REVIEW_SOURCES.filter((source) => source !== "google_business");

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; status?: string }>;
}) {
  const actor = await requireStaffActor("reviews");
  const query = await searchParams;
  const status = REVIEW_STATES.find((one) => one === query.status);
  const canManage = hasModuleAccess(actor, "reviews", "manage");
  const [t, business, reviews, rating] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(listReviews.call({ status, limit: 100 }, actor)),
    domainOrNull(aggregateRating.call({ subjectType: "business" }, actor)),
  ]);

  const locale = business?.defaultLocale ?? "en";
  const timezone = business?.timezone ?? "UTC";
  const savedMessage =
    query.saved === "asked"
      ? t("reviews.asked")
      : query.saved === "already"
        ? t("reviews.alreadyAsked")
        : query.saved
          ? t("reviews.saved")
          : null;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("reviews.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("reviews.intro")}</p>
        {rating && rating.reviewCount > 0 ? (
          <p className="mt-2 text-sm tabular-nums text-ink-muted">
            {t("reviews.rating.summary", {
              rating: rating.ratingValue,
              count: rating.reviewCount,
            })}
            {rating.withheld ? ` · ${t("reviews.withheld")}` : ""}
          </p>
        ) : null}
      </div>

      {savedMessage ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {savedMessage}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error.includes(" ") ? query.error : t("reviews.failed")}
        </p>
      ) : null}
      {!canManage ? (
        <p className="text-sm text-ink-muted">{t("reviews.readOnly")}</p>
      ) : null}

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          <span className="text-ink-muted">{t("reviews.filter.status")}</span>
          <select
            name="status"
            defaultValue={status ?? ""}
            className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
          >
            <option value="">{t("reviews.filter.any")}</option>
            {REVIEW_STATES.map((one) => (
              <option key={one} value={one}>
                {t(`reviews.status.${one}`)}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="quiet">
          {t("reviews.filter.apply")}
        </Button>
      </form>

      <Card>
        <CardHeader title={t("reviews.list")} />
        <CardBody>
          {reviews === null ? (
            <p className="text-sm text-danger">{t("reviews.unavailable")}</p>
          ) : reviews.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("reviews.empty")}</p>
          ) : (
            <ul className="grid list-none gap-4 p-0">
              {reviews.map((review) => (
                <li key={review.id} className="grid gap-3 rounded-md border border-rule p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {review.displayName ?? t("reviews.anonymous")}
                    </span>
                    <Pill tone={STATUS_TONES[review.status]}>
                      {t(`reviews.status.${review.status}`)}
                    </Pill>
                    <span className="text-sm tabular-nums text-ink-muted">
                      {t("reviews.rating.outOf", { rating: review.rating })}
                    </span>
                    <span className="text-xs text-ink-muted">
                      {t(`reviews.source.${review.source}`)}
                      {" · "}
                      {t(`reviews.subject.${review.subjectType}`)}
                    </span>
                    <time
                      dateTime={review.createdAt.toISOString()}
                      className="ms-auto font-mono text-xs text-ink-muted tabular-nums"
                    >
                      {formatDateTime(review.createdAt, timezone, locale)}
                    </time>
                  </div>
                  {review.title ? (
                    <p className="font-medium">{review.title}</p>
                  ) : null}
                  <p className="max-w-prose whitespace-pre-wrap text-sm">{review.body}</p>
                  {review.incentiveDisclosed ? (
                    <p className="text-xs text-ink-muted">{t("reviews.incentive.disclosure")}</p>
                  ) : null}
                  {review.replyBody ? (
                    <p className="max-w-prose whitespace-pre-wrap rounded-md border border-rule bg-surface-muted px-3 py-2 text-sm">
                      {review.replyBody}
                    </p>
                  ) : null}

                  {canManage ? (
                    <div className="flex flex-wrap gap-2">
                      {(["approved", "hidden", "rejected"] as const).map((next) => (
                        <form key={next} action={moderateReviewAction}>
                          <input type="hidden" name="id" value={review.id} />
                          <input type="hidden" name="status" value={next} />
                          <Button
                            type="submit"
                            variant={next === "rejected" ? "danger" : "quiet"}
                            disabled={review.status === next}
                          >
                            {next === "approved"
                              ? t("reviews.action.approve")
                              : next === "hidden"
                                ? t("reviews.action.hide")
                                : t("reviews.action.reject")}
                          </Button>
                        </form>
                      ))}
                    </div>
                  ) : null}

                  {canManage ? (
                    <form action={replyToReviewAction} className="grid gap-2">
                      <input type="hidden" name="id" value={review.id} />
                      <label className="grid gap-1 text-sm">
                        <span className="text-ink-muted">{t("reviews.field.reply")}</span>
                        <textarea
                          name="body"
                          required
                          rows={3}
                          defaultValue={review.replyBody ?? ""}
                          className="max-w-prose rounded-md border border-rule bg-field px-2 py-1 text-sm"
                        />
                      </label>
                      <div>
                        <Button type="submit" variant="quiet">
                          {t("reviews.action.reply")}
                        </Button>
                      </div>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <p className="max-w-prose text-sm text-ink-muted">{t("reviews.hideHint")}</p>
          <p className="max-w-prose text-sm text-ink-muted">{t("reviews.rejectHint")}</p>
        </CardBody>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader title={t("reviews.request")} />
          <CardBody>
            <form action={requestReviewAction} className="flex flex-wrap items-end gap-3">
              <Field label={t("reviews.field.email")} htmlFor="review-email">
                <Input id="review-email" name="email" type="email" required autoComplete="email" />
              </Field>
              <Field label={t("reviews.field.name")} htmlFor="review-name">
                <Input id="review-name" name="name" maxLength={200} />
              </Field>
              <Field label={t("reviews.field.source")} htmlFor="review-source">
                <Select id="review-source" name="source" defaultValue="manual">
                  {REQUEST_SOURCES.map((source) => (
                    <option key={source} value={source}>
                      {t(`reviews.source.${source}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit">{t("reviews.action.request")}</Button>
            </form>
            <p className="max-w-prose text-sm text-ink-muted">{t("reviews.requestHint")}</p>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
