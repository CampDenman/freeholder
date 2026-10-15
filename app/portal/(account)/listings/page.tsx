// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.08 (MASTER.md §44.8): what a member sells.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { LISTING_KINDS, myListings } from "@/modules/members/listings";
import { membershipRules, myMembership } from "@/modules/members/service";
import { Button, Callout, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { archiveListingAction, createListingAction } from "./actions";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("members.listings.title"), robots: { index: false, follow: false } };
}

export default async function ListingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const [t, jar, query] = await Promise.all([getT(), cookies(), searchParams]);
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
  const listings = await myListings.call({}, actor);
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
    </div>
  );
}
