// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner collection index (C3.25 slice 1): the taxonomy layer over the catalog.

import { SquaresFour, Trash, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { listCollections } from "@/modules/catalog/service";
import { COLLECTION_RULE_TYPES, COLLECTION_SORT_ORDERS } from "@/modules/catalog/contract";
import { listSegments } from "@/core/segments/service";
import { Button, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { collectionAction } from "../../catalog-actions";
import { requireStaffActor } from "../guard";

export const dynamic = "force-dynamic";

export default async function CollectionsPage() {
  const actor = await requireStaffActor("catalog");
  const [collections, trashed, segments, t] = await Promise.all([
    listCollections.call({}, actor),
    listCollections.call({ trashedOnly: true }, actor),
    listSegments.call({}, actor),
    getT(),
  ]);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <SquaresFour size={22} weight="duotone" className="text-accent" />
          {t("catalog.collections.title")}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("catalog.collections.intro")}</p>
      </div>

      <Card>
        <CardHeader title={t("catalog.collections.create")} />
        <CardBody>
          <form action={collectionAction} className="grid gap-5 sm:grid-cols-2">
            <input type="hidden" name="intent" value="create" />
            <Field label={t("catalog.collections.titleLabel")} htmlFor="collection-title">
              <Input id="collection-title" name="title" required maxLength={240} />
            </Field>
            <Field label={t("catalog.collections.slugLabel")} htmlFor="collection-slug" hint={t("catalog.collections.slugHint")}>
              <Input id="collection-slug" name="slug" required maxLength={180} className="font-mono" />
            </Field>
            <Field label={t("catalog.collections.ruleType")} htmlFor="collection-rule">
              <Select id="collection-rule" name="ruleType" defaultValue="manual">
                {COLLECTION_RULE_TYPES.map((rule) => (
                  <option key={rule} value={rule}>{t(`catalog.collections.rule.${rule}`)}</option>
                ))}
              </Select>
            </Field>
            <Field
              label={t("catalog.collections.segment")}
              htmlFor="collection-segment"
              hint={segments.length ? t("catalog.collections.segmentHint") : t("catalog.collections.segmentEmpty")}
            >
              <Select id="collection-segment" name="segmentId">
                <option value="">{t("catalog.collections.segmentUnset")}</option>
                {segments.map((segment) => (
                  <option key={segment.id} value={segment.id}>{segment.name}</option>
                ))}
              </Select>
            </Field>
            <Field label={t("catalog.collections.sortOrder")} htmlFor="collection-sort">
              <Select id="collection-sort" name="sortOrder" defaultValue="manual">
                {COLLECTION_SORT_ORDERS.map((order) => (
                  <option key={order} value={order}>{t(`catalog.collections.sort.${order}`)}</option>
                ))}
              </Select>
            </Field>
            <div className="self-end"><Button type="submit">{t("catalog.collections.create")}</Button></div>
          </form>
        </CardBody>
      </Card>

      {collections.length === 0 ? (
        <Card><CardBody><p className="text-sm text-ink-muted">{t("catalog.collections.empty")}</p></CardBody></Card>
      ) : (
        <ul className="grid list-none gap-3 p-0">
          {collections.map((collection) => (
            <li key={collection.id}>
              <a
                href={`/admin/collections/${collection.id}`}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-rule bg-surface px-4 py-4 hover:border-accent"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">{collection.title}</p>
                  <p className="mt-1 font-mono text-xs text-ink-muted">/c/{collection.slug}</p>
                </div>
                <Pill>{t(`catalog.collections.rule.${collection.ruleType}`)}</Pill>
                <Pill tone={collection.published ? "success" : "neutral"}>
                  {collection.published ? t("catalog.collections.published") : t("catalog.collections.draft")}
                </Pill>
              </a>
            </li>
          ))}
        </ul>
      )}

      {trashed.length > 0 ? (
        <Card>
          <CardHeader icon={<Trash size={17} weight="bold" />} title={t("catalog.collections.trashed")} />
          <CardBody>
            <ul className="grid list-none gap-3 p-0">
              {trashed.map((collection) => (
                <li key={collection.id} className="flex flex-wrap items-center gap-3 border-b border-rule pb-3 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{collection.title}</p>
                    <p className="mt-1 font-mono text-xs text-ink-muted">/c/{collection.slug}</p>
                  </div>
                  <form action={collectionAction}>
                    <input type="hidden" name="intent" value="restore" />
                    <input type="hidden" name="id" value={collection.id} />
                    <Button type="submit" variant="quiet">{t("catalog.collections.restore")}</Button>
                  </form>
                  <form action={collectionAction}>
                    <input type="hidden" name="intent" value="purge" />
                    <input type="hidden" name="id" value={collection.id} />
                    <input type="hidden" name="confirmation" value="PURGE" />
                    <Button type="submit" variant="danger" title={t("catalog.collections.purgeHint")}>
                      <WarningCircle size={14} weight="bold" />
                      {t("catalog.collections.purge")}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
