// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Persistent carts and wishlists (C5.20).

import { ShoppingCart, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { listContacts } from "@/core/contacts/service";
import { currentBusiness } from "@/core/settings/read";
import { hasModuleAccess } from "@/core/service";
import { CART_STATUSES } from "@/modules/catalog/contract";
import { listCarts } from "@/modules/catalog/service";
import { Button, Callout, Card, CardBody, CardHeader, Field, Pill, Select } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { productAction } from "../../catalog-actions";
import { requireStaffActor } from "../guard";

export const dynamic = "force-dynamic";

export default async function CartsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; status?: string }>;
}) {
  const actor = await requireStaffActor("catalog");
  const query = await searchParams;
  const status = CART_STATUSES.includes(query.status as (typeof CART_STATUSES)[number])
    ? (query.status as (typeof CART_STATUSES)[number])
    : undefined;
  const [rows, contacts, business, t] = await Promise.all([
    listCarts.call({ ...(status ? { status } : {}) }, actor),
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
          <ShoppingCart size={22} weight="duotone" className="text-accent" />
          {t("catalog.carts.title")}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("catalog.carts.intro")}</p>
      </div>
      {query.error ? <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>{query.error}</Callout> : null}
      {query.saved ? <Callout tone="success">{t(`catalog.saved.${query.saved}`)}</Callout> : null}

      <form className="grid gap-3 rounded-lg border border-rule bg-surface p-4 sm:grid-cols-[1fr_auto]">
        <Select name="status" defaultValue={status ?? ""} aria-label={t("catalog.carts.filter")}>
          <option value="">{t("catalog.carts.filterAll")}</option>
          {CART_STATUSES.map((value) => (
            <option key={value} value={value}>{t(`catalog.carts.status.${value}`)}</option>
          ))}
        </Select>
        <button className="rounded-md border border-rule px-4 py-2 text-sm font-semibold" type="submit">
          {t("catalog.carts.filter")}
        </button>
      </form>

      <Card>
        <CardHeader title={t("catalog.carts.open")} />
        <CardBody>
          {rows.length === 0 ? (
            <p className="mb-4 text-sm text-ink-muted">{t("catalog.carts.empty")}</p>
          ) : (
            <ul className="mb-4 grid list-none gap-2 p-0 text-sm">
              {rows.map((cart) => (
                <li key={cart.id}>
                  <a href={`/admin/carts/${cart.id}`} className="font-semibold hover:text-accent">
                    {cart.name ?? cart.token.slice(0, 8)}
                  </a>
                  {" · "}
                  <Pill>{t(`catalog.carts.status.${cart.status}`)}</Pill>
                  {" · "}
                  {t(`catalog.carts.kind.${cart.kind}`)}
                  {" · "}
                  {cart.currency}
                  {" · "}
                  {cart.contactId
                    ? contacts.rows.find((row) => row.id === cart.contactId)?.name ?? cart.contactId
                    : t("catalog.carts.guest")}
                </li>
              ))}
            </ul>
          )}
          {canManage ? (
            <form action={productAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="intent" value="createCart" />
              <input type="hidden" name="currency" value={currency} />
              <input type="hidden" name="returnTo" value="/admin/carts" />
              <Field label={t("catalog.carts.contact")} htmlFor="cart-contact">
                <Select id="cart-contact" name="contactId">
                  <option value="">{t("catalog.carts.noContact")}</option>
                  {contacts.rows.map((row) => (
                    <option key={row.id} value={row.id}>{row.name}</option>
                  ))}
                </Select>
              </Field>
              <div><Button type="submit">{t("catalog.carts.create")}</Button></div>
            </form>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
