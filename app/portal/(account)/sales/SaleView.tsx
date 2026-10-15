// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.10: one sale, from the buyer's or the seller's side.
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { formatDateTime, formatMoney } from "@/core/i18n";
import { ServiceError } from "@/core/service";
import { currentBusiness } from "@/core/settings/read";
import { DISPUTE_REASONS, saleThread, viewSale } from "@/modules/members/protection";
import { saleReviews } from "@/modules/members/reputation";
import { Button, Callout, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { getLocale, getT } from "../../../i18n";
import { saleAction } from "./actions";

export async function SaleView({ orderId, sellerId, side, query }: { orderId: string; sellerId: string; side: "buyer" | "seller"; query: { error?: string; saved?: string } }) {
  if (!/^[0-9a-f-]{36}$/.test(orderId) || !/^[0-9a-f-]{36}$/.test(sellerId)) notFound();
  const [t, locale, business, jar] = await Promise.all([getT(), getLocale(), currentBusiness(), cookies()]);
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  let sale, thread, reviews;
  try {
    [sale, thread, reviews] = await Promise.all([
      viewSale.call({ orderId, sellerId }, actor),
      saleThread.call({ orderId, sellerId }, actor),
      saleReviews.call({ orderId, sellerId }, actor),
    ]);
  } catch (error) {
    if (error instanceof ServiceError) notFound();
    throw error;
  }
  if (sale.role !== side) notFound();
  const timezone = business?.timezone ?? "UTC";
  const hidden = (verb: string) => (
    <>
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="sellerId" value={sellerId} />
      <input type="hidden" name="side" value={side} />
      <input type="hidden" name="verb" value={verb} />
    </>
  );
  const ships = sale.items.some((i) => i.requiresShipping);
  const openDispute = sale.dispute?.state === "open";
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">{t(side === "seller" ? "members.sales.saleTitle" : "members.sales.purchaseTitle", { name: sale.sellerName })}</h1>
      {query.saved ? <Callout tone="success">{t("members.sales.saved")}</Callout> : null}
      {query.error ? <Callout tone="danger">{t("members.sales.failed")}</Callout> : null}
      <p className="flex flex-wrap gap-2">
        <Pill>{t(`members.sales.fulfilment.${sale.fulfilment}`)}</Pill>
        {side === "seller" ? <Pill>{t(`members.sales.payout.${sale.payout}`)}</Pill> : null}
        {sale.dispute ? <Pill tone={openDispute ? "warning" : "neutral"}>{t(`members.sales.dispute.${sale.dispute.state}`)}</Pill> : null}
      </p>
      <ul className="grid gap-1">
        {sale.items.map((i, n) => <li key={n}>{i.quantity} × {i.name} · {formatMoney(i.lineTotalMinor, sale.currency, locale)}</li>)}
      </ul>
      {sale.carrier || sale.tracking ? <p className="text-sm">{t("members.sales.tracking", { carrier: sale.carrier ?? "", tracking: sale.tracking ?? "" })}</p> : null}
      {side === "seller" && sale.fulfilment !== "delivered" ? (
        <form action={saleAction} className="grid gap-3 sm:grid-cols-3 sm:items-end">
          {hidden("ship")}
          {ships ? (
            <>
              <Field label={t("members.sales.carrier")} htmlFor="carrier"><Input id="carrier" name="carrier" maxLength={80} defaultValue={sale.carrier ?? ""} /></Field>
              <Field label={t("members.sales.trackingNumber")} htmlFor="tracking"><Input id="tracking" name="tracking" maxLength={120} defaultValue={sale.tracking ?? ""} /></Field>
            </>
          ) : null}
          <Button type="submit">{t(ships ? "members.sales.markShipped" : "members.sales.markSent")}</Button>
        </form>
      ) : null}
      {side === "buyer" && sale.fulfilment !== "delivered" && !openDispute ? (
        <form action={saleAction}>{hidden("delivered")}<Button type="submit">{t("members.sales.confirmDelivery")}</Button></form>
      ) : null}
      {side === "buyer" && !sale.dispute?.state.match(/open|refunded|released/) && sale.fulfilment !== "delivered" ? (
        <Card>
          <CardHeader title={t("members.sales.disputeTitle")} />
          <CardBody>
            <p className="mb-3 text-sm text-ink-muted">{t("members.sales.disputeIntro")}</p>
            <form action={saleAction} className="grid gap-3">
              {hidden("dispute")}
              <Field label={t("members.sales.reason")} htmlFor="reason">
                <Select id="reason" name="reason">{DISPUTE_REASONS.map((r) => <option key={r} value={r}>{t(`members.sales.reasons.${r}`)}</option>)}</Select>
              </Field>
              <Field label={t("members.sales.details")} htmlFor="details">
                <textarea id="details" name="details" required minLength={10} maxLength={4000} rows={3} className="w-full rounded-md border border-rule-strong bg-field px-3 py-2 text-sm" />
              </Field>
              <div><Button type="submit" variant="danger">{t("members.sales.openDispute")}</Button></div>
            </form>
          </CardBody>
        </Card>
      ) : null}
      {side === "buyer" && openDispute ? (
        <form action={saleAction}>{hidden("withdraw")}<Button type="submit" variant="quiet">{t("members.sales.withdraw")}</Button></form>
      ) : null}
      {reviews.canReview || reviews.mine || reviews.theyWrote ? (
        <Card>
          <CardHeader title={t(side === "buyer" ? "members.reviews.ofSellerTitle" : "members.reviews.ofBuyerTitle")} />
          <CardBody>
            <div className="grid gap-3">
              <p className="text-sm text-ink-muted">{t("members.reviews.blindIntro")}</p>
              {reviews.canReview ? (
                <form action={saleAction} className="grid gap-3">
                  {hidden("review")}
                  <Field label={t("members.reviews.rating")} htmlFor="rating">
                    <Select id="rating" name="rating" defaultValue="5">
                      {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{t("members.reviews.stars", { count: n })}</option>)}
                    </Select>
                  </Field>
                  <Field label={t("members.reviews.body")} htmlFor="review-body">
                    <textarea id="review-body" name="body" maxLength={2000} rows={3} className="w-full rounded-md border border-rule-strong bg-field px-3 py-2 text-sm" />
                  </Field>
                  <div><Button type="submit">{t("members.reviews.submit")}</Button></div>
                </form>
              ) : null}
              {reviews.mine ? (
                <p className="text-sm">
                  {t("members.reviews.yours", { count: reviews.mine.rating })} {reviews.mine.revealed ? null : <Pill>{t("members.reviews.hiddenUntil")}</Pill>}
                </p>
              ) : null}
              {reviews.theyWrote && !reviews.theirs ? <p className="text-sm">{t("members.reviews.theyWrote")}</p> : null}
              {reviews.theirs ? (
                <div className="grid gap-2 rounded-md border border-rule p-3">
                  <p className="text-sm font-semibold">{t("members.reviews.theirs", { count: reviews.theirs.rating })}</p>
                  {reviews.theirs.body ? <p className="whitespace-pre-line break-words">{reviews.theirs.body}</p> : null}
                  {reviews.theirs.reply ? (
                    <p className="text-sm text-ink-muted">{t("members.reviews.yourReply")} {reviews.theirs.reply}</p>
                  ) : (
                    <form action={saleAction} className="grid gap-2">
                      {hidden("reply")}
                      <input type="hidden" name="reviewId" value={reviews.theirs.id} />
                      <Field label={t("members.reviews.reply")} htmlFor="review-reply">
                        <textarea id="review-reply" name="body" required maxLength={2000} rows={2} className="w-full rounded-md border border-rule-strong bg-field px-3 py-2 text-sm" />
                      </Field>
                      <p className="text-xs text-ink-muted">{t("members.reviews.replyOnce")}</p>
                      <div><Button type="submit" variant="quiet">{t("members.reviews.postReply")}</Button></div>
                    </form>
                  )}
                </div>
              ) : null}
            </div>
          </CardBody>
        </Card>
      ) : null}
      <section className="grid gap-3">
        <h2 className="text-xl font-semibold">{t("members.sales.thread")}</h2>
        <p className="text-sm text-ink-muted">{t("members.sales.threadPrivacy")}</p>
        <ol className="grid gap-2">
          {thread.map((m) => (
            <li key={m.id} className="grid gap-1 rounded-md border border-rule p-3">
              <p className="text-xs text-ink-muted">{t(`members.sales.role.${m.role}`)} · {formatDateTime(m.createdAt, timezone, locale)}</p>
              <p className="whitespace-pre-line break-words">{m.body}</p>
            </li>
          ))}
        </ol>
        <form action={saleAction} className="grid gap-2">
          {hidden("message")}
          <Field label={t("members.sales.message")} htmlFor="sale-message">
            <textarea id="sale-message" name="body" required maxLength={4000} rows={2} className="w-full rounded-md border border-rule-strong bg-field px-3 py-2 text-sm" />
          </Field>
          <div><Button type="submit">{t("members.messages.send")}</Button></div>
        </form>
      </section>
    </div>
  );
}
