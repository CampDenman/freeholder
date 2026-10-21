// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner collection editor (C3.25 slice 1): identity and rules, membership,
// and the reversible-removal controls.

import { notFound } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import { hasModuleAccess, ServiceError } from "@/core/service";
import { listSegments } from "@/core/segments/service";
import { COLLECTION_RULE_TYPES, COLLECTION_SORT_ORDERS } from "@/modules/catalog/contract";
import {
  getCollection,
  listProducts,
} from "@/modules/catalog/service";
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Pill,
  Select,
} from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { collectionAction } from "../../../catalog-actions";
import { requireStaffActor } from "../../guard";

export const dynamic = "force-dynamic";

export default async function CollectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const actor = await requireStaffActor("catalog");
  const { id } = await params;
  const [bundle, catalog, segments, query, t] = await Promise.all([
    getCollection.call({ id }, actor).catch((error: unknown) => {
      if (error instanceof ServiceError) notFound();
      throw error;
    }),
    listProducts.call({ limit: 500 }, actor),
    listSegments.call({}, actor),
    searchParams,
    getT(),
  ]);
  const { collection, products } = bundle;
  const seo = (collection.seo ?? {});
  const canManage = hasModuleAccess(actor, "catalog", "manage");
  const manual = collection.ruleType === "manual";
  const segment =
    collection.ruleType === "segment"
      ? segments.find((row) => row.id === (collection.ruleConfig).segmentId)
      : undefined;
  const memberIds = new Set(products.map((row) => row.productId));
  const addable = catalog.filter((product) => !memberIds.has(product.id));

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/collections" className="text-sm text-ink-muted">
          {t("catalog.collections.back")}
        </a>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight">{collection.title}</h1>
          <Pill>{t(`catalog.collections.rule.${collection.ruleType}`)}</Pill>
          <Pill tone={collection.published ? "success" : "neutral"}>
            {collection.published
              ? t("catalog.collections.published")
              : t("catalog.collections.draft")}
          </Pill>
          <span className="font-mono text-xs text-ink-muted">/c/{collection.slug}</span>
          {collection.published ? (
            <a href={`/c/${collection.slug}`} className="text-sm text-accent">
              {t("catalog.collections.view")}
            </a>
          ) : null}
        </div>
      </div>

      {query.error ? (
        <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
          {query.error}
        </Callout>
      ) : null}
      {query.saved ? <Callout tone="success">{t(`catalog.collections.saved.${query.saved}`)}</Callout> : null}

      <Card>
        <CardHeader
          title={t("catalog.collections.details")}
          status={<span className="font-mono text-xs text-ink-muted">v{collection.version}</span>}
        />
        <CardBody>
          {canManage ? (
            <form action={collectionAction} className="grid gap-5 sm:grid-cols-2">
              <input type="hidden" name="intent" value="update" />
              <input type="hidden" name="id" value={collection.id} />
              <input type="hidden" name="expectedVersion" value={collection.version} />
              <Field label={t("catalog.collections.titleLabel")} htmlFor="collection-title">
                <Input id="collection-title" name="title" defaultValue={collection.title} required maxLength={240} />
              </Field>
              <Field label={t("catalog.collections.slugLabel")} htmlFor="collection-slug" hint={t("catalog.collections.slugHint")}>
                <Input id="collection-slug" name="slug" defaultValue={collection.slug} required maxLength={180} className="font-mono" />
              </Field>
              <Field label={t("catalog.collections.description")} htmlFor="collection-description">
                <Input id="collection-description" name="description" defaultValue={collection.description ?? ""} maxLength={1000} />
              </Field>
              <Field label={t("catalog.collections.ruleType")} htmlFor="collection-rule" hint={t("catalog.collections.ruleHint")}>
                <Select id="collection-rule" name="ruleType" defaultValue={collection.ruleType}>
                  {COLLECTION_RULE_TYPES.map((rule) => (
                    <option key={rule} value={rule}>{t(`catalog.collections.rule.${rule}`)}</option>
                  ))}
                </Select>
              </Field>
              <Field
                label={t("catalog.collections.segment")}
                htmlFor="collection-segment"
                hint={t("catalog.collections.segmentHint")}
              >
                <Select
                  id="collection-segment"
                  name="segmentId"
                  defaultValue={(collection.ruleConfig).segmentId ?? ""}
                >
                  <option value="">{t("catalog.collections.segmentUnset")}</option>
                  {segments.map((row) => (
                    <option key={row.id} value={row.id}>{row.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("catalog.collections.sortOrder")} htmlFor="collection-sort">
                <Select id="collection-sort" name="sortOrder" defaultValue={collection.sortOrder}>
                  {COLLECTION_SORT_ORDERS.map((order) => (
                    <option key={order} value={order}>{t(`catalog.collections.sort.${order}`)}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("catalog.seoTitle")} htmlFor="collection-seo-title" hint={t("catalog.seoTitleHint")}>
                <Input id="collection-seo-title" name="seoTitle" defaultValue={seo.title ?? ""} maxLength={60} />
              </Field>
              <Field label={t("catalog.seoDescription")} htmlFor="collection-seo-description" hint={t("catalog.seoDescriptionHint")}>
                <Input id="collection-seo-description" name="seoDescription" defaultValue={seo.description ?? ""} maxLength={155} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="published"
                  value="true"
                  defaultChecked={collection.published}
                />
                {t("catalog.collections.publishLabel")}
              </label>
              <div><Button type="submit">{t("common.save")}</Button></div>
            </form>
          ) : (
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div><dt className="font-mono text-xs text-ink-muted">{t("catalog.collections.description")}</dt><dd>{collection.description ?? "—"}</dd></div>
              <div><dt className="font-mono text-xs text-ink-muted">{t("catalog.collections.ruleType")}</dt><dd>{t(`catalog.collections.rule.${collection.ruleType}`)}</dd></div>
            </dl>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t("catalog.collections.products")}
          status={<span className="text-xs text-ink-muted">{t("catalog.collections.productCount", { count: products.length })}</span>}
        />
        <CardBody>
          {!manual ? (
            <p className="mb-4 text-sm text-ink-muted">
              {t("catalog.collections.derived", { segment: segment?.name ?? t("catalog.collections.segmentUnset") })}
            </p>
          ) : null}
          {products.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("catalog.collections.productsEmpty")}</p>
          ) : (
            <ol className="grid list-none gap-2 p-0">
              {products.map((row, index) => (
                <li key={row.productId} className="flex flex-wrap items-center gap-3 rounded-md border border-rule px-3 py-2">
                  <span className="text-xs text-ink-muted">{index + 1}</span>
                  <a href={`/admin/products/${row.productId}`} className="min-w-0 flex-1 font-medium text-ink">
                    {row.name}
                  </a>
                  <Pill tone={row.status === "active" ? "success" : row.status === "archived" ? "neutral" : "warning"}>
                    {t(`catalog.status.${row.status}`)}
                  </Pill>
                  {canManage && manual ? (
                    <>
                      <form action={collectionAction}>
                        <input type="hidden" name="intent" value="move" />
                        <input type="hidden" name="collectionId" value={collection.id} />
                        <input type="hidden" name="productId" value={row.productId} />
                        <input type="hidden" name="direction" value="up" />
                        <Button type="submit" variant="quiet" disabled={index === 0} aria-label={t("catalog.collections.moveUp")}>
                          <ArrowUp size={14} weight="bold" />
                        </Button>
                      </form>
                      <form action={collectionAction}>
                        <input type="hidden" name="intent" value="move" />
                        <input type="hidden" name="collectionId" value={collection.id} />
                        <input type="hidden" name="productId" value={row.productId} />
                        <input type="hidden" name="direction" value="down" />
                        <Button type="submit" variant="quiet" disabled={index === products.length - 1} aria-label={t("catalog.collections.moveDown")}>
                          <ArrowDown size={14} weight="bold" />
                        </Button>
                      </form>
                      <form action={collectionAction}>
                        <input type="hidden" name="intent" value="removeProduct" />
                        <input type="hidden" name="collectionId" value={collection.id} />
                        <input type="hidden" name="productId" value={row.productId} />
                        <Button type="submit" variant="quiet">{t("catalog.collections.remove")}</Button>
                      </form>
                    </>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
          {canManage && manual && addable.length > 0 ? (
            <form action={collectionAction} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
              <input type="hidden" name="intent" value="addProduct" />
              <input type="hidden" name="collectionId" value={collection.id} />
              <Select name="productId" aria-label={t("catalog.collections.addProduct")}>
                {addable.map((product) => (
                  <option key={product.id} value={product.id}>{product.name}</option>
                ))}
              </Select>
              <Button type="submit">{t("catalog.collections.addProduct")}</Button>
            </form>
          ) : null}
        </CardBody>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader icon={<Trash size={17} weight="bold" />} title={t("catalog.collections.danger")} />
          <CardBody>
            <p className="mb-3 text-sm text-ink-muted">{t("catalog.collections.trashHint")}</p>
            <form action={collectionAction}>
              <input type="hidden" name="intent" value="trash" />
              <input type="hidden" name="id" value={collection.id} />
              <Button type="submit" variant="danger">{t("catalog.collections.trash")}</Button>
            </form>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
