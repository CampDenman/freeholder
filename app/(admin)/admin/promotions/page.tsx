// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Coupons, gift cards and cart offers (C5.23).

import { Ticket, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { listContacts } from "@/core/contacts/service";
import { currentBusiness } from "@/core/settings/read";
import { hasModuleAccess } from "@/core/service";
import { COUPON_KINDS, OFFER_RULE_KINDS } from "@/modules/catalog/contract";
import {
  listCoupons,
  listGiftCards,
  listOfferRules,
  listSellableVariants,
} from "@/modules/catalog/service";
import { Button, Callout, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { productAction } from "../../catalog-actions";
import { requireStaffActor } from "../guard";
import { money } from "../invoices/format";

export const dynamic = "force-dynamic";

export default async function PromotionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const actor = await requireStaffActor("catalog");
  const query = await searchParams;
  const [codes, cards, offers, variants, contacts, business, t] = await Promise.all([
    listCoupons.call({}, actor),
    listGiftCards.call({}, actor),
    listOfferRules.call({}, actor),
    listSellableVariants.call({}, actor),
    listContacts.call({ limit: 80 }, actor).catch(() => ({ rows: [] as Array<{ id: string; name: string }> })),
    currentBusiness(),
    getT(),
  ]);
  const canManage = hasModuleAccess(actor, "catalog", "manage");
  const currency = business?.baseCurrency ?? "CAD";

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <Ticket size={22} weight="duotone" className="text-accent" />
          {t("catalog.promo.title")}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("catalog.promo.intro")}</p>
      </div>
      {query.error ? <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>{query.error}</Callout> : null}
      {query.saved ? <Callout tone="success">{t(`catalog.saved.${query.saved}`)}</Callout> : null}

      <Card>
        <CardHeader title={t("catalog.promo.coupons")} />
        <CardBody>
          {codes.length === 0 ? (
            <p className="mb-4 text-sm text-ink-muted">{t("catalog.promo.couponsEmpty")}</p>
          ) : (
            <ul className="mb-4 grid list-none gap-2 p-0 text-sm">
              {codes.map((row) => (
                <li key={row.id}>
                  <span className="font-mono font-semibold">{row.code}</span>
                  {" · "}
                  <Pill>{t(`catalog.promo.couponKind.${row.kind}`)}</Pill>
                  {row.recovery ? ` · ${t("catalog.promo.recovery")}` : null}
                </li>
              ))}
            </ul>
          )}
          {canManage ? (
            <form action={productAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="intent" value="createCoupon" />
              <input type="hidden" name="currency" value={currency} />
              <Field label={t("catalog.promo.code")} htmlFor="coupon-code"><Input id="coupon-code" name="code" required /></Field>
              <Field label={t("catalog.promo.kind")} htmlFor="coupon-kind">
                <Select id="coupon-kind" name="kind" required>
                  {COUPON_KINDS.map((kind) => (
                    <option key={kind} value={kind}>{t(`catalog.promo.couponKind.${kind}`)}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("catalog.promo.percentPpm")} htmlFor="coupon-ppm">
                <Input id="coupon-ppm" name="percentOffPpm" inputMode="numeric" defaultValue="100000" />
              </Field>
              <Field label={t("catalog.promo.amount")} htmlFor="coupon-amount">
                <Input id="coupon-amount" name="amount" inputMode="decimal" />
              </Field>
              <div><Button type="submit">{t("catalog.promo.createCoupon")}</Button></div>
            </form>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("catalog.promo.giftCards")} />
        <CardBody>
          {cards.length === 0 ? (
            <p className="mb-4 text-sm text-ink-muted">{t("catalog.promo.giftCardsEmpty")}</p>
          ) : (
            <ul className="mb-4 grid list-none gap-2 p-0 text-sm">
              {cards.map((row) => (
                <li key={row.id}>
                  <span className="font-mono font-semibold">{row.code}</span>
                  {" · "}
                  {money(row.remainingMinor, row.currency)} / {money(row.issuedMinor, row.currency)}
                  {" · "}
                  <Pill>{t(`catalog.promo.giftStatus.${row.status}`)}</Pill>
                </li>
              ))}
            </ul>
          )}
          {canManage ? (
            <form action={productAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="intent" value="issueGiftCard" />
              <input type="hidden" name="currency" value={currency} />
              <Field label={t("catalog.promo.code")} htmlFor="gift-code"><Input id="gift-code" name="code" required /></Field>
              <Field label={t("catalog.promo.amount")} htmlFor="gift-amount">
                <Input id="gift-amount" name="amount" inputMode="decimal" required />
              </Field>
              <Field label={t("catalog.promo.contact")} htmlFor="gift-contact">
                <Select id="gift-contact" name="contactId">
                  <option value="">{t("catalog.promo.noContact")}</option>
                  {contacts.rows.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </Select>
              </Field>
              <div><Button type="submit">{t("catalog.promo.issueGift")}</Button></div>
            </form>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("catalog.promo.offers")} />
        <CardBody>
          {offers.length === 0 ? (
            <p className="mb-4 text-sm text-ink-muted">{t("catalog.promo.offersEmpty")}</p>
          ) : (
            <ul className="mb-4 grid list-none gap-2 p-0 text-sm">
              {offers.map((row) => (
                <li key={row.id}>
                  {row.name} · <Pill>{t(`catalog.promo.offerKind.${row.kind}`)}</Pill>
                </li>
              ))}
            </ul>
          )}
          {canManage && variants.length ? (
            <form action={productAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="intent" value="createOfferRule" />
              <Field label={t("catalog.promo.offerName")} htmlFor="offer-name"><Input id="offer-name" name="name" required /></Field>
              <Field label={t("catalog.promo.kind")} htmlFor="offer-kind">
                <Select id="offer-kind" name="kind" required>
                  {OFFER_RULE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>{t(`catalog.promo.offerKind.${kind}`)}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("catalog.promo.trigger")} htmlFor="offer-trigger">
                <Select id="offer-trigger" name="triggerVariantId">
                  <option value="">{t("catalog.promo.anyTrigger")}</option>
                  {variants.map((row) => <option key={row.id} value={row.id}>{row.productName} · {row.sku}</option>)}
                </Select>
              </Field>
              <Field label={t("catalog.promo.offerVariant")} htmlFor="offer-variant">
                <Select id="offer-variant" name="offerVariantId" required>
                  {variants.map((row) => <option key={row.id} value={row.id}>{row.productName} · {row.sku}</option>)}
                </Select>
              </Field>
              <div><Button type="submit">{t("catalog.promo.createOffer")}</Button></div>
            </form>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
