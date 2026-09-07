// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Gift registries (MASTER.md §36, C3.13).
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { listContacts } from "@/core/contacts/service";
import {
  listGiftRegistries,
  listGiftRegistryItems,
} from "../../../../plugins/gift-registry/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import {
  addGiftRegistryItemAction,
  createGiftRegistryAction,
  invoiceGiftRegistryItemAction,
} from "../../first-party-plugin-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function GiftsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; registry?: string }>;
}) {
  const actor = await requireStaffActor("giftRegistry", "manage");
  const query = await searchParams;
  const [t, registries, people] = await Promise.all([
    getT(),
    domainOrNull(listGiftRegistries.call({}, actor)),
    domainOrNull(listContacts.call({ limit: 100 }, actor)),
  ]);
  const chosen =
    (registries ?? []).find((row) => row.id === query.registry) ?? (registries ?? [])[0] ?? null;
  const items = chosen
    ? await domainOrNull(listGiftRegistryItems.call({ registryId: chosen.id }, actor))
    : [];

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("gifts.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("gifts.intro")}</p>
      </div>
      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("gifts.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("gifts.create")} />
        <CardBody>
          <form action={createGiftRegistryAction} className="grid gap-3 sm:grid-cols-3">
            <Field label={t("gifts.field.contact")} htmlFor="gift-contact">
              <Select id="gift-contact" name="contactId" required>
                <option value="">{t("gifts.field.contact")}</option>
                {(people?.rows ?? []).map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("gifts.field.title")} htmlFor="gift-title">
              <Input id="gift-title" name="title" required />
            </Field>
            <Field label={t("gifts.field.slug")} htmlFor="gift-slug">
              <Input id="gift-slug" name="slug" required />
            </Field>
            <div className="sm:col-span-3">
              <Button type="submit">{t("gifts.create")}</Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("gifts.list")} />
        <CardBody>
          {(registries ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">{t("gifts.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {(registries ?? []).map((registry) => (
                <li key={registry.id}>
                  <a className="text-sm font-medium text-accent" href={`/admin/gifts?registry=${registry.id}`}>
                    {registry.title}
                  </a>
                  <span className="ms-2 font-mono text-xs text-ink-muted">{registry.slug}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {chosen ? (
        <Card>
          <CardHeader title={chosen.title} />
          <CardBody>
            {(items ?? []).length === 0 ? (
              <p className="text-sm text-ink-muted">{t("gifts.itemsEmpty")}</p>
            ) : (
              <ul className="grid list-none gap-2 p-0">
                {(items ?? []).map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm">
                    <span>{item.title}</span>
                    <Pill tone={item.status === "invoiced" ? "success" : item.status === "failed" ? "danger" : "neutral"}>
                      {t(`gifts.status.${item.status}`)}
                    </Pill>
                    {item.lastError ? <span className="text-danger">{item.lastError}</span> : null}
                    {item.status !== "invoiced" ? (
                      <form action={invoiceGiftRegistryItemAction}>
                        <input type="hidden" name="itemId" value={item.id} />
                        <Button type="submit" variant="quiet">
                          {item.status === "failed" ? t("gifts.retry") : t("gifts.invoice")}
                        </Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <form action={addGiftRegistryItemAction} className="grid gap-3 sm:grid-cols-3">
              <input type="hidden" name="registryId" value={chosen.id} />
              <Field label={t("gifts.field.item")} htmlFor="gift-item">
                <Input id="gift-item" name="title" required />
              </Field>
              <Field label={t("gifts.field.amount")} htmlFor="gift-amount">
                <Input id="gift-amount" name="amountCents" type="number" min={0} defaultValue="0" />
              </Field>
              <Field label={t("gifts.field.url")} htmlFor="gift-url">
                <Input id="gift-url" name="url" />
              </Field>
              <div className="sm:col-span-3">
                <Button type="submit">{t("gifts.addItem")}</Button>
              </div>
            </form>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
