// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.08 (MASTER.md §44.8): what a member sells.
import type { Metadata } from "next";
import { formatDateTime } from "@/core/i18n";
import { currentBusiness } from "@/core/settings/read";
import { bookingAction } from "./booking-actions";
import { myBookingHours, myServiceBookings } from "@/modules/members/member-services";
import { planAction } from "./plan-actions";
import { myMemberPlans } from "@/modules/members/member-subscriptions";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { LISTING_KINDS, myListings } from "@/modules/members/listings";
import { membershipRules, myMembership } from "@/modules/members/service";
import { marketPolicy } from "@/modules/members/policy";
import { Button, Callout, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { getLocale, getT } from "../../../i18n";
import { archiveListingAction, createListingAction } from "./actions";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("members.listings.title"), robots: { index: false, follow: false } };
}

export default async function ListingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const [t, jar, query, locale, business] = await Promise.all([getT(), cookies(), searchParams, getLocale(), currentBusiness()]);
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  const [me, rules] = await Promise.all([actor.kind === "user" ? myMembership.call({}, actor) : null, membershipRules.call({}, actor)]);
  if (!me || me.status !== "active") {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">{t("members.listings.title")}</h1>
        <p>{t("members.profile.notMember")}</p>
      </div>
    );
  }
  if (!rules.marketplaceEnabled) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">{t("members.listings.title")}</h1>
        <p>{t("members.listings.closed")}</p>
      </div>
    );
  }
  const [listings, policy, plans, hours, upcoming] = await Promise.all([myListings.call({}, actor), marketPolicy.call({}, actor), myMemberPlans.call({}, actor), myBookingHours.call({}, actor), myServiceBookings.call({}, actor)]);
  const days = new Set(hours.hours.map((h) => h.weekday));
  const window = hours.hours[0] ?? { starts: "09:00", ends: "17:00" };
  const weekdays = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">{t("members.listings.title")}</h1>
      <Callout>{t("members.listings.notYetSelling")}</Callout>
      {query.saved ? <Callout tone="success">{t("members.listings.saved")}</Callout> : null}
      {query.error ? <Callout tone="danger">{t("members.listings.failed")}</Callout> : null}
      <Card>
        <CardHeader title={t("members.listings.new")} />
        <CardBody>
          <form action={createListingAction} className="grid gap-4">
            <Field label={t("members.listings.field.title")} htmlFor="listing-title">
              <Input id="listing-title" name="title" required minLength={2} maxLength={120} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("members.listings.field.kind")} htmlFor="listing-kind">
                <Select id="listing-kind" name="kind" defaultValue="physical">
                  {LISTING_KINDS.map((k) => <option key={k} value={k}>{t(`members.listings.kind.${k}`)}</option>)}
                </Select>
              </Field>
              <Field label={t("members.listings.field.price")} htmlFor="listing-price" hint={t("members.listings.field.priceHint")}>
                <Input id="listing-price" name="price" required inputMode="decimal" pattern="\d{1,9}(\.\d{1,2})?" />
              </Field>
            </div>
            <Field label={t("members.listings.field.description")} htmlFor="listing-description">
              <textarea id="listing-description" name="description" maxLength={5000} rows={4} className="w-full rounded-md border border-rule-strong bg-field px-3 py-2 text-sm" />
            </Field>
            {rules.adultContent && me.isAdult ? (
            <label className="flex items-start gap-2">
              <input type="checkbox" name="adult" value="yes" />
              <span>{t("members.adult.markListing")}</span>
            </label>
          ) : null}
            {policy.acceptedByYou ? null : (
              <label className="flex items-start gap-2">
                <input type="checkbox" name="acceptPolicy" value="yes" required />
                <span>{t(policy.version > 1 ? "members.policy.acceptChanged" : "members.policy.accept")} <a className="underline" href="/market/policy" target="_blank" rel="noopener">{t("members.policy.read")}</a></span>
              </label>
            )}
            <p className="text-sm text-ink-muted">{t(rules.listingReview ? "members.listings.reviewed" : "members.listings.immediate")}</p>
            <Button type="submit">{t("members.listings.create")}</Button>
          </form>
        </CardBody>
      </Card>
      <section className="grid gap-3">
        <h2 className="text-xl font-semibold">{t("members.listings.yours", { count: listings.length })}</h2>
        {listings.length === 0 ? <p className="text-ink-muted">{t("members.listings.none")}</p> : null}
        <ul className="grid gap-3">
          {listings.map((l) => (
            <li key={l.productId} className="grid gap-2 rounded-md border border-rule p-3">
              <p className="flex flex-wrap items-center gap-2">
                {l.status === "active" ? <a className="font-semibold underline" href={`/products/${l.slug}`}>{l.name}</a> : <strong>{l.name}</strong>}
                <Pill>{t(`members.listings.kind.${l.kind}`)}</Pill>
                <Pill tone={l.review === "rejected" ? "danger" : l.review === "pending" ? "warning" : l.status === "active" ? "success" : "neutral"}>
                  {t(l.review === "approved" ? `members.listings.status.${l.status}` : `members.listings.review.${l.review}`)}
                </Pill>
              </p>
              {l.reviewNote ? <p className="text-sm">{t("members.listings.reviewNote", { note: l.reviewNote })}</p> : null}
              {l.kind === "service" && l.review === "approved" && l.status === "active" ? (
                <details>
                  <summary className="cursor-pointer text-sm underline">{t("members.bookings.offer")}</summary>
                  <form action={bookingAction} className="mt-2 grid gap-3">
                    <input type="hidden" name="verb" value="offer" />
                    <input type="hidden" name="productId" value={l.productId} />
                    <div className="grid gap-3 sm:grid-cols-4">
                      <Field label={t("members.bookings.duration")} htmlFor={`duration-${l.productId}`}><Input id={`duration-${l.productId}`} name="durationMin" type="number" min={15} max={480} step={15} defaultValue={60} /></Field>
                      <Field label={t("members.bookings.where")} htmlFor={`where-${l.productId}`}>
                        <Select id={`where-${l.productId}`} name="locationType" defaultValue="virtual">
                          {(["virtual", "in_person", "client_site"] as const).map((k) => <option key={k} value={k}>{t(`members.bookings.location.${k}`)}</option>)}
                        </Select>
                      </Field>
                      <Field label={t("members.bookings.from")} htmlFor={`starts-${l.productId}`}><Input id={`starts-${l.productId}`} name="starts" type="time" defaultValue={window.starts} /></Field>
                      <Field label={t("members.bookings.until")} htmlFor={`ends-${l.productId}`}><Input id={`ends-${l.productId}`} name="ends" type="time" defaultValue={window.ends} /></Field>
                    </div>
                    <fieldset className="grid gap-2">
                    <legend className="text-sm font-medium">{t("members.bookings.days")}</legend>
                    <div className="flex flex-wrap gap-3">
                      {weekdays.map((d) => (
                        <label key={d} className="flex items-center gap-1 text-sm"><input type="checkbox" name="weekday" value={d} defaultChecked={hours.calendarId ? days.has(d) : d >= 1 && d <= 5} />{t(`members.bookings.weekday.${d}`)}</label>
                      ))}
                    </div>
                  </fieldset>
                    <div><Button type="submit">{t("members.bookings.save")}</Button></div>
                  </form>
                </details>
              ) : null}
              {l.review === "approved" ? (
                <form action={archiveListingAction}>
                  <input type="hidden" name="productId" value={l.productId} />
                  <input type="hidden" name="archived" value={l.status === "archived" ? "no" : "yes"} />
                  <Button type="submit" variant="quiet">{t(l.status === "archived" ? "members.listings.restore" : "members.listings.archive")}</Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      {hours.calendarId ? (
        <Card>
          <CardHeader title={t("members.bookings.title")} />
          <CardBody>
            <form action={bookingAction} className="mb-4 grid gap-3">
              <input type="hidden" name="verb" value="hours" />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("members.bookings.from")} htmlFor="hours-starts"><Input id="hours-starts" name="starts" type="time" defaultValue={window.starts} /></Field>
                <Field label={t("members.bookings.until")} htmlFor="hours-ends"><Input id="hours-ends" name="ends" type="time" defaultValue={window.ends} /></Field>
              </div>
              <fieldset className="grid gap-2">
                    <legend className="text-sm font-medium">{t("members.bookings.days")}</legend>
                    <div className="flex flex-wrap gap-3">
                      {weekdays.map((d) => (
                        <label key={d} className="flex items-center gap-1 text-sm"><input type="checkbox" name="weekday" value={d} defaultChecked={hours.calendarId ? days.has(d) : d >= 1 && d <= 5} />{t(`members.bookings.weekday.${d}`)}</label>
                      ))}
                    </div>
                  </fieldset>
              <div><Button type="submit">{t("members.bookings.saveHours")}</Button></div>
            </form>
            <h3 className="mb-2 font-semibold">{t("members.bookings.upcoming")}</h3>
            {upcoming.length === 0 ? <p className="text-sm text-ink-muted">{t("members.bookings.none")}</p> : (
              <ul className="grid gap-2">
                {upcoming.map((b) => (
                  <li key={b.id} className="rounded-md border border-rule p-3 text-sm">
                    <strong>{b.service ?? ""}</strong> · {formatDateTime(b.startsAt, business?.timezone ?? "UTC", locale)} · {b.customer ?? ""} · {t(`members.bookings.status.${b.status}`)}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("members.plans.title")} />
        <CardBody>
          <p className="mb-3 text-sm text-ink-muted">{t("members.plans.intro")}</p>
          <ul className="mb-4 grid gap-2">
            {plans.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-rule p-3">
                <span><strong>{p.name}</strong> · {t(`members.plans.interval.${p.interval}`)} · {t("members.plans.subscribers", { count: p.subscribers })}</span>
                <form action={planAction}>
                  <input type="hidden" name="planId" value={p.id} />
                  <input type="hidden" name="verb" value={p.status === "active" ? "stop" : "offer"} />
                  <Button type="submit" variant="quiet">{t(p.status === "active" ? "members.plans.stop" : "members.plans.offer")}</Button>
                </form>
              </li>
            ))}
          </ul>
          <form action={planAction} className="grid gap-3">
            <input type="hidden" name="verb" value="create" />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("members.plans.name")} htmlFor="plan-name"><Input id="plan-name" name="name" required minLength={2} maxLength={80} /></Field>
              <Field label={t("members.plans.price")} htmlFor="plan-price"><Input id="plan-price" name="price" required inputMode="decimal" pattern="\d{1,7}(\.\d{1,2})?" /></Field>
              <Field label={t("members.plans.every")} htmlFor="plan-interval">
                <Select id="plan-interval" name="interval" defaultValue="month">
                  <option value="month">{t("members.plans.interval.month")}</option>
                  <option value="year">{t("members.plans.interval.year")}</option>
                </Select>
              </Field>
            </div>
            <Field label={t("members.plans.description")} htmlFor="plan-description"><Input id="plan-description" name="description" maxLength={500} /></Field>
            <div><Button type="submit">{t("members.plans.create")}</Button></div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
