// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One cart, live prices, checkout (C5.20, C5.21).

import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { listContacts } from "@/core/contacts/service";
import { listLocations } from "@/core/locations/service";
import { hasModuleAccess, ServiceError } from "@/core/service";
import {
  getCart,
  listSellableVariants,
} from "@/modules/catalog/service";
import { Button, Callout, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { productAction } from "../../../catalog-actions";
import { requireStaffActor } from "../../guard";
import { money } from "../../invoices/format";

export const dynamic = "force-dynamic";

export default async function CartDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const actor = await requireStaffActor("catalog");
  const { id } = await params;
  const query = await searchParams;
  const basket = await getCart.call({ cartId: id }, actor).catch((error: unknown) => {
    if (error instanceof ServiceError && error.code === "not_found") notFound();
    throw error;
  });
  const [variants, locations, contacts, t] = await Promise.all([
    listSellableVariants.call({}, actor),
    listLocations.call({}, actor),
    listContacts.call({ limit: 80 }, actor).catch(() => ({ rows: [] as Array<{ id: string; name: string }> })),
    getT(),
  ]);
  const canManage = hasModuleAccess(actor, "catalog", "manage");
  const needsShipping = basket.lines.some((line) => line.requiresShipping);
  const contactName = basket.cart.contactId
    ? contacts.rows.find((row) => row.id === basket.cart.contactId)?.name
    : null;

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/carts" className="text-sm text-ink-muted">{t("catalog.carts.back")}</a>
        <h1 className="mt-2 flex flex-wrap items-center gap-3 text-xl font-bold tracking-tight">
          {basket.cart.name ?? basket.cart.token.slice(0, 8)}
          <Pill>{t(`catalog.carts.status.${basket.cart.status}`)}</Pill>
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {contactName ?? t("catalog.carts.guest")} · {basket.cart.currency} · {t(`catalog.carts.kind.${basket.cart.kind}`)}
        </p>
      </div>
      {query.error ? <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>{query.error}</Callout> : null}
      {query.saved ? <Callout tone="success">{t(`catalog.saved.${query.saved}`)}</Callout> : null}

      <Card>
        <CardHeader title={t("catalog.carts.lines")} />
        <CardBody>
          {basket.lines.length === 0 ? (
            <p className="mb-4 text-sm text-ink-muted">{t("catalog.carts.linesEmpty")}</p>
          ) : (
            <ul className="mb-4 grid list-none gap-3 p-0 text-sm">
              {basket.lines.map((line) => (
                <li key={line.id} className="flex flex-wrap items-center gap-3">
                  <span className="font-semibold">{line.productName} · {line.sku}</span>
                  <span className="font-mono">
                    {line.lineTotalMinor != null
                      ? money(line.lineTotalMinor, basket.cart.currency)
                      : line.priceReason}
                  </span>
                  {canManage && basket.cart.status === "open" && basket.cart.kind === "cart" ? (
                    <form action={productAction} className="ms-auto flex items-center gap-2">
                      <input type="hidden" name="intent" value="setCartQty" />
                      <input type="hidden" name="cartId" value={basket.cart.id} />
                      <input type="hidden" name="variantId" value={line.variantId} />
                      <input type="hidden" name="returnTo" value={`/admin/carts/${basket.cart.id}`} />
                      <Input name="quantity" inputMode="numeric" defaultValue={String(line.quantity)} className="w-20" />
                      <Button type="submit">{t("catalog.carts.quantity")}</Button>
                    </form>
                  ) : (
                    <span className="ms-auto">{line.quantity}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm font-semibold">
            {t("catalog.carts.subtotal")} {money(basket.subtotalMinor, basket.cart.currency)}
          </p>
          {canManage && basket.cart.status === "open" && basket.cart.kind === "cart" && variants.length ? (
            <form action={productAction} className="mt-4 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="intent" value="addCartItem" />
              <input type="hidden" name="cartId" value={basket.cart.id} />
              <input type="hidden" name="returnTo" value={`/admin/carts/${basket.cart.id}`} />
              <Field label={t("catalog.carts.variant")} htmlFor="cart-variant">
                <Select id="cart-variant" name="variantId" required>
                  {variants.map((row) => (
                    <option key={row.id} value={row.id}>{row.productName} · {row.sku}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("catalog.carts.quantity")} htmlFor="cart-qty">
                <Input id="cart-qty" name="quantity" inputMode="numeric" defaultValue="1" required />
              </Field>
              <Field label={t("catalog.carts.location")} htmlFor="cart-loc">
                <Select id="cart-loc" name="locationId">
                  <option value="">{t("catalog.carts.noLocation")}</option>
                  {locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </Select>
              </Field>
              <div><Button type="submit">{t("catalog.carts.add")}</Button></div>
            </form>
          ) : null}
        </CardBody>
      </Card>

      {canManage && basket.cart.contactId && basket.cart.status === "open" ? (
        <Card>
          <CardHeader title={t("catalog.carts.save")} />
          <CardBody>
            <form action={productAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="intent" value="saveCart" />
              <input type="hidden" name="cartId" value={basket.cart.id} />
              <input type="hidden" name="returnTo" value={`/admin/carts/${basket.cart.id}`} />
              <Field label={t("catalog.carts.saveName")} htmlFor="cart-name">
                <Input id="cart-name" name="name" required />
              </Field>
              <div><Button type="submit">{t("catalog.carts.save")}</Button></div>
            </form>
          </CardBody>
        </Card>
      ) : null}

      {canManage && basket.cart.status === "open" && basket.cart.kind === "cart" ? (
        <Card>
          <CardHeader title={t("catalog.promo.applyCoupon")} />
          <CardBody>
            <form action={productAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="intent" value="applyCoupon" />
              <input type="hidden" name="cartId" value={basket.cart.id} />
              <input type="hidden" name="returnTo" value={`/admin/carts/${basket.cart.id}`} />
              <Field label={t("catalog.promo.code")} htmlFor="cart-coupon">
                <Input id="cart-coupon" name="code" required />
              </Field>
              <div><Button type="submit">{t("catalog.promo.applyCoupon")}</Button></div>
            </form>
          </CardBody>
        </Card>
      ) : null}

      {canManage && basket.cart.status === "open" && basket.cart.kind === "cart" ? (
        <Card>
          <CardHeader title={t("catalog.carts.checkout")} />
          <CardBody>
            <form action={productAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="intent" value="checkoutCart" />
              <input type="hidden" name="cartId" value={basket.cart.id} />
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <input type="hidden" name="returnTo" value={`/admin/carts/${basket.cart.id}`} />
              <Field label={t("catalog.carts.contact")} htmlFor="checkout-contact">
                <Select id="checkout-contact" name="contactId" required defaultValue={basket.cart.contactId ?? ""}>
                  <option value="">{t("catalog.carts.noContact")}</option>
                  {contacts.rows.map((row) => (
                    <option key={row.id} value={row.id}>{row.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("catalog.promo.code")} htmlFor="checkout-coupon">
                <Input id="checkout-coupon" name="couponCode" />
              </Field>
              <Field label={t("catalog.promo.giftCode")} htmlFor="checkout-gift">
                <Input id="checkout-gift" name="giftCardCode" />
              </Field>
              <label className="col-span-full flex items-center gap-2 text-sm">
                <input type="checkbox" name="applyBalance" value="yes" />
                {t("catalog.promo.applyBalance")}
              </label>
              {needsShipping ? (
                <>
                  <Field label={t("catalog.carts.shipName")} htmlFor="ship-name">
                    <Input id="ship-name" name="shipName" />
                  </Field>
                  <Field label={t("catalog.carts.street")} htmlFor="ship-street">
                    <Input id="ship-street" name="street1" />
                  </Field>
                  <Field label={t("catalog.carts.city")} htmlFor="ship-city">
                    <Input id="ship-city" name="city" />
                  </Field>
                  <Field label={t("catalog.carts.region")} htmlFor="ship-region">
                    <Input id="ship-region" name="region" />
                  </Field>
                  <Field label={t("catalog.carts.postal")} htmlFor="ship-postal">
                    <Input id="ship-postal" name="postalCode" />
                  </Field>
                  <Field label={t("catalog.carts.country")} htmlFor="ship-country">
                    <Input id="ship-country" name="country" required defaultValue="CA" />
                  </Field>
                </>
              ) : null}
              <label className="col-span-full flex items-center gap-2 text-sm">
                <input type="checkbox" name="acceptedTerms" value="yes" required />
                {t("catalog.carts.terms")}
              </label>
              <div><Button type="submit">{t("catalog.carts.checkout")}</Button></div>
            </form>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
