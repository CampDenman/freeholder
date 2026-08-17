// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Price lists, customer groups and currency-specific catalog prices (C5.13).

import { CurrencyDollar, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { listContacts } from "@/core/contacts/service";
import { currentBusiness } from "@/core/settings/read";
import { hasModuleAccess } from "@/core/service";
import { PRICE_BREAK_MODES, PRICE_LIST_KINDS } from "@/modules/catalog/contract";
import {
  listCustomerGroups,
  listPriceLists,
} from "@/modules/catalog/service";
import { Button, Callout, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { productAction } from "../../catalog-actions";
import { requireStaffActor } from "../guard";

export const dynamic = "force-dynamic";

export default async function PriceListsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const actor = await requireStaffActor("catalog");
  const query = await searchParams;
  const [lists, groups, contacts, business, t] = await Promise.all([
    listPriceLists.call({}, actor),
    listCustomerGroups.call({}, actor),
    listContacts.call({ limit: 100 }, actor).catch(() => ({ rows: [], total: 0 })),
    currentBusiness(),
    getT(),
  ]);
  const canManage = hasModuleAccess(actor, "catalog", "manage");

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <CurrencyDollar size={22} weight="duotone" className="text-accent" />
          {t("catalog.prices.listsTitle")}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("catalog.prices.listsIntro")}</p>
      </div>
      {query.error ? <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>{query.error}</Callout> : null}
      {query.saved ? <Callout tone="success">{t(`catalog.saved.${query.saved}`)}</Callout> : null}

      <Card>
        <CardHeader title={t("catalog.prices.groups")} />
        <CardBody>
          {groups.length === 0 ? <p className="mb-4 text-sm text-ink-muted">{t("catalog.prices.groupsEmpty")}</p> : (
            <ul className="mb-4 grid list-none gap-2 p-0 text-sm">
              {groups.map((group) => (
                <li key={group.id}>{group.name}{group.tag ? ` · ${group.tag}` : ""}{group.lifecycleStage ? ` · ${group.lifecycleStage}` : ""}</li>
              ))}
            </ul>
          )}
          {canManage ? (
            <form action={productAction} className="grid gap-3 sm:grid-cols-3">
              <input type="hidden" name="intent" value="createGroup" />
              <input type="hidden" name="returnTo" value="/admin/price-lists" />
              <Field label={t("catalog.prices.groupName")} htmlFor="group-name"><Input id="group-name" name="name" required /></Field>
              <Field label={t("catalog.prices.groupTag")} htmlFor="group-tag"><Input id="group-tag" name="tag" /></Field>
              <div className="self-end"><Button type="submit">{t("catalog.prices.createGroup")}</Button></div>
            </form>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("catalog.prices.listsTitle")} />
        <CardBody>
          {lists.length === 0 ? <p className="mb-4 text-sm text-ink-muted">{t("catalog.prices.listsEmpty")}</p> : (
            <ul className="mb-4 grid list-none gap-3 p-0">
              {lists.map((list) => (
                <li key={list.id} className="rounded-md border border-rule p-3 text-sm">
                  <div className="flex flex-wrap gap-2">
                    <span className="font-semibold">{list.name}</span>
                    <Pill>{list.currency}</Pill>
                    <Pill>{t(`catalog.prices.kind.${list.kind}`)}</Pill>
                    <span className="text-ink-muted">{t("catalog.prices.entryCount", { count: list.entries.length })}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {canManage ? (
            <form action={productAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="intent" value="createPriceList" />
              <input type="hidden" name="returnTo" value="/admin/price-lists" />
              <Field label={t("catalog.prices.listName")} htmlFor="list-name"><Input id="list-name" name="name" required /></Field>
              <Field label={t("catalog.prices.currency")} htmlFor="list-currency">
                <Input id="list-currency" name="currency" required maxLength={3} defaultValue={business?.baseCurrency ?? "USD"} className="font-mono uppercase" />
              </Field>
              <Field label={t("catalog.prices.kindLabel")} htmlFor="list-kind">
                <Select id="list-kind" name="kind" required>
                  {PRICE_LIST_KINDS.map((kind) => <option key={kind} value={kind}>{t(`catalog.prices.kind.${kind}`)}</option>)}
                </Select>
              </Field>
              <Field label={t("catalog.prices.group")} htmlFor="list-group">
                <Select id="list-group" name="customerGroupId">
                  <option value="">{t("catalog.prices.noGroup")}</option>
                  {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </Select>
              </Field>
              <Field label={t("catalog.prices.contractContact")} htmlFor="list-contact">
                <Select id="list-contact" name="contactId">
                  <option value="">{t("catalog.prices.noContact")}</option>
                  {contacts.rows.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
                </Select>
              </Field>
              <Field label={t("catalog.prices.priority")} htmlFor="list-priority"><Input id="list-priority" name="priority" defaultValue="0" /></Field>
              <Field label={t("catalog.prices.startsAt")} htmlFor="list-start"><Input id="list-start" name="startsAt" type="datetime-local" /></Field>
              <Field label={t("catalog.prices.endsAt")} htmlFor="list-end"><Input id="list-end" name="endsAt" type="datetime-local" /></Field>
              <div className="sm:col-span-2"><Button type="submit">{t("catalog.prices.createList")}</Button></div>
            </form>
          ) : null}
        </CardBody>
      </Card>

      {canManage && lists.length ? (
        <Card>
          <CardHeader title={t("catalog.breaks.title")} />
          <CardBody>
            <p className="mb-4 text-sm text-ink-muted">{t("catalog.breaks.intro")}</p>
            <form action={productAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="intent" value="setBreak" />
              <input type="hidden" name="returnTo" value="/admin/price-lists" />
              <Field label={t("catalog.prices.list")} htmlFor="break-list">
                <Select id="break-list" name="priceListId" required>
                  {lists.map((list) => <option key={list.id} value={list.id}>{list.name} ({list.currency})</option>)}
                </Select>
              </Field>
              <Field label={t("catalog.breaks.mode")} htmlFor="break-mode">
                <Select id="break-mode" name="mode" required>
                  {PRICE_BREAK_MODES.map((mode) => <option key={mode} value={mode}>{t(`catalog.breaks.mode.${mode}`)}</option>)}
                </Select>
              </Field>
              <Field label={t("catalog.breaks.min")} htmlFor="break-min"><Input id="break-min" name="minQty" required defaultValue="1" /></Field>
              <Field label={t("catalog.breaks.max")} htmlFor="break-max"><Input id="break-max" name="maxQty" /></Field>
              <Field label={t("catalog.breaks.amount")} htmlFor="break-amount"><Input id="break-amount" name="amount" inputMode="decimal" /></Field>
              <div className="sm:col-span-2"><Button type="submit">{t("catalog.breaks.add")}</Button></div>
            </form>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
