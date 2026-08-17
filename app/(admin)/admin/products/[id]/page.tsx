// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Complete owner product lifecycle workspace for C5.09.

import { notFound } from "next/navigation";
import { Archive, ClockCounterClockwise, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { formatDateTime } from "@/core/i18n";
import { listAssets } from "@/core/media/service";
import { currentBusiness } from "@/core/settings/read";
import { hasModuleAccess, ServiceError } from "@/core/service";
import { PRODUCT_KINDS, PRODUCT_VISIBILITIES } from "@/modules/catalog/contract";
import {
  getProduct,
  getProductVariants,
  getServiceOffering,
  listAttributeDefinitions,
  listCancellationPolicies,
  listBundleComponents,
  listOptionTypes,
  listPriceLists,
  listPriceRules,
  listProductAttributes,
  listProductMedia,
  listProductRelations,
  listProducts,
  listProductTaxCategories,
} from "@/modules/catalog/service";
import {
  ATTRIBUTE_KINDS,
  BUNDLE_PRICE_MODES,
  CANCELLATION_FEE_TYPES,
  MEDIA_ROLES,
  PRICE_RULE_MODES,
  RELATION_KINDS,
  SERVICE_ASSIGNMENTS,
  SERVICE_DEPOSIT_TYPES,
  SERVICE_LOCATION_TYPES,
} from "@/modules/catalog/contract";
import { listForms } from "@/modules/forms/service";
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
import { productAction } from "../../../catalog-actions";
import { requireStaffActor } from "../../guard";
import { editorBlockTypes, editorLabels } from "../../editorLabels";
import { ProductEditor } from "./ProductEditor";

export const dynamic = "force-dynamic";

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const actor = await requireStaffActor("catalog");
  const { id } = await params;
  const [bundle, categories, optionTypes, variantBundle, attributes, facts, media, prices, relations, components, catalog, offering, policies, rules, intakeForms, query, business, t] = await Promise.all([
    getProduct.call({ id }, actor).catch((error: unknown) => {
      if (error instanceof ServiceError) notFound();
      throw error;
    }),
    listProductTaxCategories.call({}, actor),
    listOptionTypes.call({}, actor),
    getProductVariants.call({ productId: id }, actor).catch(() => null),
    listAttributeDefinitions.call({}, actor),
    listProductAttributes.call({ productId: id }, actor),
    listProductMedia.call({ productId: id }, actor),
    listPriceLists.call({}, actor),
    listProductRelations.call({ productId: id }, actor),
    listBundleComponents.call({ productId: id }, actor),
    listProducts.call({ limit: 200 }, actor),
    getServiceOffering.call({ productId: id }, actor),
    listCancellationPolicies.call({}, actor),
    listPriceRules.call({ productId: id }, actor),
    hasModuleAccess(actor, "forms")
      ? listForms.call({}, actor).catch(() => [])
      : Promise.resolve([]),
    searchParams,
    currentBusiness(),
    getT(),
  ]);
  const otherVariants =
    bundle.product.kind === "bundle"
      ? (
          await Promise.all(
            catalog
              .filter((row) => row.id !== id)
              .slice(0, 20)
              .map((row) => getProductVariants.call({ productId: row.id }, actor).catch(() => null)),
          )
        ).flatMap((row) => row?.variants ?? [])
      : [];
  const canManage = hasModuleAccess(actor, "catalog", "manage");
  const canUseMedia = canManage && hasModuleAccess(actor, "media");
  const [library, mediaLibrary] = canUseMedia
    ? await Promise.all([
        listAssets.call({ kind: "image" }, actor),
        listAssets.call({}, actor),
      ])
    : [{ rows: [] }, { rows: [] }];
  const { product, history } = bundle;
  const seo = product.seo;
  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";
  const kindLocked = Boolean(product.publishedAt);

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/products" className="text-sm text-ink-muted">{t("catalog.back")}</a>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight">{product.name}</h1>
          <Pill tone={product.status === "active" ? "success" : product.status === "archived" ? "neutral" : "warning"}>
            {t(`catalog.status.${product.status}`)}
          </Pill>
          <Pill>{t(`catalog.kind.${product.kind}`)}</Pill>
          <span className="font-mono text-xs text-ink-muted">{t("catalog.pathPrefix")}{product.slug}</span>
        </div>
      </div>

      {query.error ? <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>{query.error}</Callout> : null}
      {query.saved ? <Callout tone="success">{t(`catalog.saved.${query.saved}`)}</Callout> : null}
      {product.status === "archived" ? <Callout>{t("catalog.archivedReadOnly")}</Callout> : null}

      <Card>
        <CardHeader title={t("catalog.details")} status={<span className="font-mono text-xs text-ink-muted">v{product.version}</span>} />
        <CardBody>
          {canManage && product.status !== "archived" ? (
            <form action={productAction} className="grid gap-5 sm:grid-cols-2">
              <input type="hidden" name="intent" value="update" />
              <input type="hidden" name="id" value={product.id} />
              <input type="hidden" name="expectedVersion" value={product.version} />
              <Field label={t("catalog.name")} htmlFor="name"><Input id="name" name="name" defaultValue={product.name} required maxLength={240} /></Field>
              <Field label={t("catalog.slug")} htmlFor="slug" hint={t("catalog.slugHint")}><Input id="slug" name="slug" defaultValue={product.slug} required maxLength={180} className="font-mono" /></Field>
              <Field label={t("catalog.kind")} htmlFor="kind" hint={kindLocked ? t("catalog.kindLocked") : undefined}>
                <Select id="kind" name="kind" defaultValue={product.kind} disabled={kindLocked}>{PRODUCT_KINDS.map((kind) => <option key={kind} value={kind}>{t(`catalog.kind.${kind}`)}</option>)}</Select>
              </Field>
              <Field label={t("catalog.visibility")} htmlFor="visibility"><Select id="visibility" name="visibility" defaultValue={product.visibility}>{PRODUCT_VISIBILITIES.map((visibility) => <option key={visibility} value={visibility}>{t(`catalog.visibility.${visibility}`)}</option>)}</Select></Field>
              <Field label={t("catalog.subtitle")} htmlFor="subtitle"><Input id="subtitle" name="subtitle" defaultValue={product.subtitle ?? ""} maxLength={300} /></Field>
              <Field label={t("catalog.brand")} htmlFor="brand"><Input id="brand" name="brand" defaultValue={product.brand ?? ""} maxLength={200} /></Field>
              <Field label={t("catalog.taxCategory")} htmlFor="taxCategoryId" hint={categories.length ? t("catalog.taxCategoryHint") : t("catalog.taxCategoryEmpty")}>
                <Select id="taxCategoryId" name="taxCategoryId" defaultValue={product.taxCategoryId ?? ""}>
                  <option value="">{t("catalog.taxCategoryUnset")}</option>
                  {categories.map((category) => <option key={category.id} value={category.id} disabled={!category.active && category.id !== product.taxCategoryId}>{category.name} ({category.code}){category.active ? "" : ` — ${t("catalog.taxCategoryInactive")}`}</option>)}
                </Select>
              </Field>
              <div />
              <Field label={t("catalog.seoTitle")} htmlFor="seoTitle" hint={t("catalog.seoTitleHint")}><Input id="seoTitle" name="seoTitle" defaultValue={seo.title ?? ""} maxLength={60} /></Field>
              <Field label={t("catalog.seoDescription")} htmlFor="seoDescription" hint={t("catalog.seoDescriptionHint")}><Input id="seoDescription" name="seoDescription" defaultValue={seo.description ?? ""} maxLength={155} /></Field>
              <div><Button type="submit">{t("common.save")}</Button></div>
            </form>
          ) : (
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div><dt className="font-mono text-xs text-ink-muted">{t("catalog.visibility")}</dt><dd>{t(`catalog.visibility.${product.visibility}`)}</dd></div>
              <div><dt className="font-mono text-xs text-ink-muted">{t("catalog.taxCategory")}</dt><dd>{categories.find((category) => category.id === product.taxCategoryId)?.name ?? t("catalog.taxCategoryUnset")}</dd></div>
              <div><dt className="font-mono text-xs text-ink-muted">{t("catalog.subtitle")}</dt><dd>{product.subtitle ?? "—"}</dd></div>
              <div><dt className="font-mono text-xs text-ink-muted">{t("catalog.brand")}</dt><dd>{product.brand ?? "—"}</dd></div>
            </dl>
          )}
        </CardBody>
      </Card>

      {canManage && product.status !== "archived" && variantBundle ? (
        <Card>
          <CardHeader title={t("catalog.variants.title")} />
          <CardBody>
            <p className="mb-4 text-sm text-ink-muted">{t("catalog.variants.intro")}</p>
            <form action={productAction} className="mb-6 grid gap-3 sm:grid-cols-3">
              <input type="hidden" name="intent" value="createOptionType" />
              <input type="hidden" name="id" value={product.id} />
              <input type="hidden" name="expectedVersion" value={product.version} />
              <Field label={t("catalog.variants.typeName")} htmlFor="option-type-name">
                <Input id="option-type-name" name="name" required maxLength={80} />
              </Field>
              <Field label={t("catalog.variants.typeCode")} htmlFor="option-type-code" hint={t("catalog.variants.typeCodeHint")}>
                <Input id="option-type-code" name="code" required maxLength={40} className="font-mono" />
              </Field>
              <div className="self-end"><Button type="submit">{t("catalog.variants.createType")}</Button></div>
            </form>

            {optionTypes.map((type) => (
              <div key={type.id} className="mb-6 rounded-md border border-rule p-3">
                <p className="font-semibold">{type.name} <span className="font-mono text-xs text-ink-muted">{type.code}</span></p>
                <form action={productAction} className="mt-3 grid gap-3 sm:grid-cols-4">
                  <input type="hidden" name="intent" value="addOptionValue" />
                  <input type="hidden" name="id" value={product.id} />
                  <input type="hidden" name="expectedVersion" value={product.version} />
                  <input type="hidden" name="optionTypeId" value={type.id} />
                  <Field label={t("catalog.variants.valueName")} htmlFor={`value-name-${type.id}`}>
                    <Input id={`value-name-${type.id}`} name="name" required maxLength={80} />
                  </Field>
                  <Field label={t("catalog.variants.skuFragment")} htmlFor={`value-sku-${type.id}`}>
                    <Input id={`value-sku-${type.id}`} name="skuFragment" required maxLength={24} className="font-mono" />
                  </Field>
                  <div className="self-end"><Button type="submit">{t("catalog.variants.addValue")}</Button></div>
                </form>
                {!variantBundle.assignments.some((assignment) => assignment.optionTypeId === type.id) ? (
                  <form action={productAction} className="mt-3">
                    <input type="hidden" name="intent" value="assignOption" />
                    <input type="hidden" name="id" value={product.id} />
                    <input type="hidden" name="expectedVersion" value={product.version} />
                    <input type="hidden" name="optionTypeId" value={type.id} />
                    <Button type="submit" variant="quiet">{t("catalog.variants.assign")}</Button>
                  </form>
                ) : null}
              </div>
            ))}

            {variantBundle.assignments.map((assignment) => (
              <form key={assignment.id} action={productAction} className="mb-4 rounded-md border border-rule p-3">
                <input type="hidden" name="intent" value="setOptionValues" />
                <input type="hidden" name="id" value={product.id} />
                <input type="hidden" name="expectedVersion" value={product.version} />
                <input type="hidden" name="optionTypeId" value={assignment.optionTypeId} />
                <p className="mb-2 font-medium">{assignment.optionType?.name ?? assignment.optionTypeId}</p>
                <fieldset className="grid gap-2">
                  <legend className="sr-only">{t("catalog.variants.valuesFor", { name: assignment.optionType?.name ?? "" })}</legend>
                  {assignment.values.map((value) => (
                    <label key={value.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="optionValueId"
                        value={value.id}
                        defaultChecked={assignment.selectedValueIds.includes(value.id)}
                      />
                      {value.name} <span className="font-mono text-xs text-ink-muted">{value.skuFragment}</span>
                    </label>
                  ))}
                </fieldset>
                <div className="mt-3"><Button type="submit">{t("catalog.variants.saveValues")}</Button></div>
              </form>
            ))}

            <div className="mb-4 grid gap-2 text-sm">
              <p>{t("catalog.variants.previewAdd", { count: variantBundle.preview.add.length })}</p>
              <p>{t("catalog.variants.previewRetain", { count: variantBundle.preview.retain.length })}</p>
              <p>{t("catalog.variants.previewArchive", { count: variantBundle.preview.archive.length })}</p>
              <p>{t("catalog.variants.previewReactivate", { count: variantBundle.preview.reactivate.length })}</p>
            </div>
            <form action={productAction}>
              <input type="hidden" name="intent" value="applyMatrix" />
              <input type="hidden" name="id" value={product.id} />
              <input type="hidden" name="expectedVersion" value={product.version} />
              <Button type="submit">{t("catalog.variants.apply")}</Button>
            </form>

            {variantBundle.variants.length ? (
              <ul className="mt-6 grid list-none gap-2 p-0">
                {variantBundle.variants.map((variant) => (
                  <li key={variant.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono">{variant.sku}</span>
                    <Pill tone={variant.status === "active" ? "success" : "neutral"}>{variant.status}</Pill>
                    {variant.isDefault ? <Pill>{t("catalog.variants.default")}</Pill> : null}
                    {variant.status === "active" && !variant.isDefault ? (
                      <form action={productAction}>
                        <input type="hidden" name="intent" value="setDefaultVariant" />
                        <input type="hidden" name="id" value={product.id} />
                        <input type="hidden" name="expectedVersion" value={product.version} />
                        <input type="hidden" name="variantId" value={variant.id} />
                        <Button type="submit" variant="quiet">{t("catalog.variants.makeDefault")}</Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-ink-muted">{t("catalog.variants.empty")}</p>
            )}
          </CardBody>
        </Card>
      ) : null}

      {canManage && product.status !== "archived" ? (
        <Card>
          <CardHeader title={t("catalog.attributes.title")} />
          <CardBody>
            <p className="mb-4 text-sm text-ink-muted">{t("catalog.attributes.intro")}</p>
            <form action={productAction} className="mb-6 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="intent" value="createAttribute" />
              <input type="hidden" name="id" value={product.id} />
              <input type="hidden" name="expectedVersion" value={product.version} />
              <Field label={t("catalog.attributes.key")} htmlFor="attr-key"><Input id="attr-key" name="key" required className="font-mono" /></Field>
              <Field label={t("catalog.attributes.label")} htmlFor="attr-label"><Input id="attr-label" name="label" required /></Field>
              <Field label={t("catalog.attributes.kind")} htmlFor="attr-kind">
                <Select id="attr-kind" name="kind" required>
                  {ATTRIBUTE_KINDS.map((kind) => <option key={kind} value={kind}>{t(`catalog.attributes.kind.${kind}`)}</option>)}
                </Select>
              </Field>
              <Field label={t("catalog.attributes.unit")} htmlFor="attr-unit"><Input id="attr-unit" name="unit" /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isFilterable" value="yes" />{t("catalog.attributes.filterable")}</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isComparable" value="yes" />{t("catalog.attributes.comparable")}</label>
              <div className="sm:col-span-2"><Button type="submit">{t("catalog.attributes.create")}</Button></div>
            </form>
            {facts.length ? (
              <ul className="mb-4 grid list-none gap-2 p-0 text-sm">
                {facts.map((fact) => (
                  <li key={fact.attributeId}>
                    <span className="font-medium">{fact.label}</span>
                    <span className="ms-2 text-ink-muted">{fact.numberValue ?? fact.textValue ?? (fact.boolValue == null ? "" : fact.boolValue ? t("common.yes") : t("common.no"))}{fact.unit ? ` ${fact.unit}` : ""}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="mb-4 text-sm text-ink-muted">{t("catalog.attributes.empty")}</p>}
            {attributes.length ? (
              <form action={productAction} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="intent" value="setAttribute" />
                <input type="hidden" name="id" value={product.id} />
                <input type="hidden" name="expectedVersion" value={product.version} />
                <Field label={t("catalog.attributes.attribute")} htmlFor="set-attr">
                  <Select id="set-attr" name="attributeId" required>
                    {attributes.map((attribute) => <option key={attribute.id} value={attribute.id}>{attribute.label}</option>)}
                  </Select>
                </Field>
                <Field label={t("catalog.attributes.value")} htmlFor="set-attr-text"><Input id="set-attr-text" name="text" /></Field>
                <Field label={t("catalog.attributes.number")} htmlFor="set-attr-number"><Input id="set-attr-number" name="number" /></Field>
                <div><Button type="submit">{t("catalog.attributes.save")}</Button></div>
              </form>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {canManage && product.status !== "archived" ? (
        <Card>
          <CardHeader title={t("catalog.media.title")} />
          <CardBody>
            <p className="mb-4 text-sm text-ink-muted">{t("catalog.media.intro")}</p>
            {media.length === 0 ? <p className="mb-4 text-sm text-ink-muted">{t("catalog.media.empty")}</p> : (
              <ul className="mb-4 grid list-none gap-2 p-0 text-sm">
                {media.map(({ media: item, asset }) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{asset.filename}</span>
                    <span className="text-ink-muted">{t(`catalog.media.role.${item.role}`)} · {asset.kind}</span>
                    <form action={productAction} className="ms-auto">
                      <input type="hidden" name="intent" value="detachMedia" />
                      <input type="hidden" name="id" value={product.id} />
                      <input type="hidden" name="expectedVersion" value={product.version} />
                      <input type="hidden" name="mediaId" value={item.id} />
                      <Button type="submit" variant="quiet">{t("catalog.media.detach")}</Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            {mediaLibrary.rows.length ? (
              <form action={productAction} className="grid gap-3 sm:grid-cols-3">
                <input type="hidden" name="intent" value="attachMedia" />
                <input type="hidden" name="id" value={product.id} />
                <input type="hidden" name="expectedVersion" value={product.version} />
                <Field label={t("catalog.media.asset")} htmlFor="media-asset">
                  <Select id="media-asset" name="assetId" required>
                    {mediaLibrary.rows.map((asset) => <option key={asset.id} value={asset.id}>{asset.filename} ({asset.kind})</option>)}
                  </Select>
                </Field>
                <Field label={t("catalog.media.roleLabel")} htmlFor="media-role">
                  <Select id="media-role" name="role" required>
                    {MEDIA_ROLES.map((role) => <option key={role} value={role}>{t(`catalog.media.role.${role}`)}</option>)}
                  </Select>
                </Field>
                <Field label={t("catalog.media.variant")} htmlFor="media-variant">
                  <Select id="media-variant" name="variantId">
                    <option value="">{t("catalog.media.allVariants")}</option>
                    {(variantBundle?.variants ?? []).map((variant) => <option key={variant.id} value={variant.id}>{variant.sku}</option>)}
                  </Select>
                </Field>
                <div><Button type="submit">{t("catalog.media.attach")}</Button></div>
              </form>
            ) : <p className="text-sm text-ink-muted">{t("catalog.media.noAssets")}</p>}
          </CardBody>
        </Card>
      ) : null}

      {canManage && product.status !== "archived" ? (
        <Card>
          <CardHeader title={t("catalog.prices.title")} />
          <CardBody>
            <p className="mb-4 text-sm text-ink-muted">{t("catalog.prices.intro")}</p>
            <p className="mb-4 text-sm"><a href="/admin/price-lists" className="font-semibold text-accent">{t("catalog.prices.manageLists")}</a></p>
            {prices.length && (variantBundle?.variants.length ?? 0) ? (
              <form action={productAction} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="intent" value="setPrice" />
                <input type="hidden" name="id" value={product.id} />
                <input type="hidden" name="returnTo" value={`/admin/products/${product.id}`} />
                <Field label={t("catalog.prices.list")} htmlFor="price-list">
                  <Select id="price-list" name="priceListId" required>
                    {prices.map((list) => <option key={list.id} value={list.id}>{list.name} ({list.currency})</option>)}
                  </Select>
                </Field>
                <Field label={t("catalog.prices.variant")} htmlFor="price-variant">
                  <Select id="price-variant" name="variantId" required>
                    {(variantBundle?.variants ?? []).map((variant) => <option key={variant.id} value={variant.id}>{variant.sku}</option>)}
                  </Select>
                </Field>
                <Field label={t("catalog.prices.amount")} htmlFor="price-amount"><Input id="price-amount" name="amount" inputMode="decimal" required /></Field>
                <Field label={t("catalog.prices.compareAt")} htmlFor="price-compare"><Input id="price-compare" name="compareAt" inputMode="decimal" /></Field>
                <div><Button type="submit">{t("catalog.prices.save")}</Button></div>
              </form>
            ) : <p className="text-sm text-ink-muted">{t("catalog.prices.empty")}</p>}
          </CardBody>
        </Card>
      ) : null}

      {canManage && product.status !== "archived" ? (
        <Card>
          <CardHeader title={t("catalog.relations.title")} />
          <CardBody>
            <p className="mb-4 text-sm text-ink-muted">{t("catalog.relations.intro")}</p>
            {relations.length === 0 ? <p className="mb-4 text-sm text-ink-muted">{t("catalog.relations.empty")}</p> : (
              <ul className="mb-4 grid list-none gap-2 p-0 text-sm">
                {relations.map((relation) => (
                  <li key={relation.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{relation.related.name}</span>
                    <span className="text-ink-muted">{t(`catalog.relations.kind.${relation.kind}`)}</span>
                    <form action={productAction} className="ms-auto">
                      <input type="hidden" name="intent" value="removeRelation" />
                      <input type="hidden" name="id" value={product.id} />
                      <input type="hidden" name="expectedVersion" value={product.version} />
                      <input type="hidden" name="relationId" value={relation.id} />
                      <Button type="submit" variant="quiet">{t("catalog.relations.remove")}</Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <form action={productAction} className="grid gap-3 sm:grid-cols-3">
              <input type="hidden" name="intent" value="addRelation" />
              <input type="hidden" name="id" value={product.id} />
              <input type="hidden" name="expectedVersion" value={product.version} />
              <Field label={t("catalog.relations.product")} htmlFor="related-product">
                <Select id="related-product" name="relatedProductId" required>
                  {catalog.filter((row) => row.id !== product.id).map((row) => (
                    <option key={row.id} value={row.id}>{row.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("catalog.relations.kindLabel")} htmlFor="related-kind">
                <Select id="related-kind" name="kind" required>
                  {RELATION_KINDS.map((kind) => <option key={kind} value={kind}>{t(`catalog.relations.kind.${kind}`)}</option>)}
                </Select>
              </Field>
              <div className="self-end"><Button type="submit">{t("catalog.relations.add")}</Button></div>
            </form>
          </CardBody>
        </Card>
      ) : null}

      {canManage && product.status !== "archived" && product.kind === "service" ? (
        <Card>
          <CardHeader title={t("catalog.offering.title")} />
          <CardBody>
            <p className="mb-4 text-sm text-ink-muted">{t("catalog.offering.intro")}</p>
            <form action={productAction} className="mb-6 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="intent" value="saveOffering" />
              <input type="hidden" name="id" value={product.id} />
              <input type="hidden" name="expectedVersion" value={product.version} />
              <input type="hidden" name="currency" value={business?.baseCurrency ?? "CAD"} />
              <Field label={t("catalog.offering.duration")} htmlFor="offering-duration">
                <Input id="offering-duration" name="durationMin" inputMode="numeric" required defaultValue={offering?.durationMin ?? 60} />
              </Field>
              <Field label={t("catalog.offering.bufferBefore")} htmlFor="offering-buffer-before">
                <Input id="offering-buffer-before" name="bufferBeforeMin" inputMode="numeric" defaultValue={offering?.bufferBeforeMin ?? 0} />
              </Field>
              <Field label={t("catalog.offering.bufferAfter")} htmlFor="offering-buffer-after">
                <Input id="offering-buffer-after" name="bufferAfterMin" inputMode="numeric" defaultValue={offering?.bufferAfterMin ?? 0} />
              </Field>
              <Field label={t("catalog.offering.travel")} htmlFor="offering-travel">
                <Input id="offering-travel" name="travelTimeMin" inputMode="numeric" defaultValue={offering?.travelTimeMin ?? 0} />
              </Field>
              <Field label={t("catalog.offering.location")} htmlFor="offering-location">
                <Select id="offering-location" name="locationType" required defaultValue={offering?.locationType ?? "in_person"}>
                  {SERVICE_LOCATION_TYPES.map((type) => (
                    <option key={type} value={type}>{t(`catalog.offering.locationType.${type}`)}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("catalog.offering.assignment")} htmlFor="offering-assignment">
                <Select id="offering-assignment" name="assignment" defaultValue={offering?.assignment ?? "specific"}>
                  {SERVICE_ASSIGNMENTS.map((type) => (
                    <option key={type} value={type}>{t(`catalog.offering.assignmentType.${type}`)}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("catalog.offering.capacity")} htmlFor="offering-capacity">
                <Input id="offering-capacity" name="capacity" inputMode="numeric" defaultValue={offering?.capacity ?? 1} />
              </Field>
              <Field label={t("catalog.offering.deposit")} htmlFor="offering-deposit">
                <Select id="offering-deposit" name="depositType" defaultValue={offering?.depositType ?? "none"}>
                  {SERVICE_DEPOSIT_TYPES.map((type) => (
                    <option key={type} value={type}>{t(`catalog.offering.depositType.${type}`)}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("catalog.offering.depositAmount")} htmlFor="offering-deposit-amount">
                <Input id="offering-deposit-amount" name="depositAmount" inputMode="decimal" />
              </Field>
              <Field label={t("catalog.offering.depositPercent")} htmlFor="offering-deposit-ppm">
                <Input id="offering-deposit-ppm" name="depositPercentPpm" inputMode="numeric" defaultValue={offering?.depositType === "percent" ? offering.depositValue : ""} />
              </Field>
              <Field label={t("catalog.offering.policy")} htmlFor="offering-policy">
                <Select id="offering-policy" name="cancellationPolicyId" defaultValue={offering?.cancellationPolicyId ?? ""}>
                  <option value="">{t("catalog.offering.noPolicy")}</option>
                  {policies.map((policy) => <option key={policy.id} value={policy.id}>{policy.name}</option>)}
                </Select>
              </Field>
              <Field label={t("catalog.offering.intake")} htmlFor="offering-intake">
                <Select id="offering-intake" name="intakeFormId" defaultValue={offering?.intakeFormId ?? ""}>
                  <option value="">{t("catalog.offering.noForm")}</option>
                  {intakeForms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}
                </Select>
              </Field>
              <p className="sm:col-span-2 text-sm text-ink-muted">{t("catalog.offering.calendarsLater")}</p>
              <div><Button type="submit">{t("catalog.offering.save")}</Button></div>
            </form>

            <h2 className="mb-3 text-sm font-semibold">{t("catalog.offering.policiesTitle")}</h2>
            {policies.length === 0 ? <p className="mb-3 text-sm text-ink-muted">{t("catalog.offering.policiesEmpty")}</p> : (
              <ul className="mb-3 grid list-none gap-2 p-0 text-sm">
                {policies.map((policy) => (
                  <li key={policy.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{policy.name}</span>
                    <span className="text-ink-muted">{t(`catalog.offering.feeType.${policy.feeType}`)}</span>
                    <form action={productAction} className="ms-auto">
                      <input type="hidden" name="intent" value="deletePolicy" />
                      <input type="hidden" name="id" value={product.id} />
                      <input type="hidden" name="expectedVersion" value={product.version} />
                      <input type="hidden" name="policyId" value={policy.id} />
                      <Button type="submit" variant="quiet">{t("catalog.offering.deletePolicy")}</Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <form action={productAction} className="mb-6 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="intent" value="createPolicy" />
              <input type="hidden" name="id" value={product.id} />
              <input type="hidden" name="expectedVersion" value={product.version} />
              <input type="hidden" name="currency" value={business?.baseCurrency ?? "CAD"} />
              <Field label={t("catalog.offering.policyName")} htmlFor="policy-name">
                <Input id="policy-name" name="name" required />
              </Field>
              <Field label={t("catalog.offering.freeUntil")} htmlFor="policy-free">
                <Input id="policy-free" name="freeUntilHours" inputMode="numeric" defaultValue={24} />
              </Field>
              <Field label={t("catalog.offering.fee")} htmlFor="policy-fee">
                <Select id="policy-fee" name="feeType" defaultValue="none">
                  {CANCELLATION_FEE_TYPES.map((type) => (
                    <option key={type} value={type}>{t(`catalog.offering.feeType.${type}`)}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("catalog.offering.feeAmount")} htmlFor="policy-fee-amount">
                <Input id="policy-fee-amount" name="feeAmount" inputMode="decimal" />
              </Field>
              <div className="self-end"><Button type="submit">{t("catalog.offering.createPolicy")}</Button></div>
            </form>

            <h2 className="mb-3 text-sm font-semibold">{t("catalog.offering.rulesTitle")}</h2>
            {rules.length === 0 ? <p className="mb-3 text-sm text-ink-muted">{t("catalog.offering.rulesEmpty")}</p> : (
              <ul className="mb-3 grid list-none gap-2 p-0 text-sm">
                {rules.map((rule) => (
                  <li key={rule.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t(`catalog.offering.ruleMode.${rule.mode}`)}</span>
                    <form action={productAction} className="ms-auto">
                      <input type="hidden" name="intent" value="removePriceRule" />
                      <input type="hidden" name="id" value={product.id} />
                      <input type="hidden" name="expectedVersion" value={product.version} />
                      <input type="hidden" name="mode" value={rule.mode} />
                      <Button type="submit" variant="quiet">{t("catalog.offering.removeRule")}</Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <form action={productAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="intent" value="setPriceRule" />
              <input type="hidden" name="id" value={product.id} />
              <input type="hidden" name="expectedVersion" value={product.version} />
              <Field label={t("catalog.offering.rule")} htmlFor="rule-mode">
                <Select id="rule-mode" name="mode" required>
                  {PRICE_RULE_MODES.map((mode) => (
                    <option key={mode} value={mode}>{t(`catalog.offering.ruleMode.${mode}`)}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("catalog.offering.installments")} htmlFor="rule-installments">
                <Input id="rule-installments" name="installmentCount" inputMode="numeric" />
              </Field>
              <Field label={t("catalog.offering.intervalDays")} htmlFor="rule-interval">
                <Input id="rule-interval" name="intervalDays" inputMode="numeric" />
              </Field>
              <Field label={t("catalog.offering.periodDays")} htmlFor="rule-period">
                <Input id="rule-period" name="periodDays" inputMode="numeric" />
              </Field>
              <div><Button type="submit">{t("catalog.offering.addRule")}</Button></div>
            </form>
          </CardBody>
        </Card>
      ) : null}

      {canManage && product.status !== "archived" && product.kind === "bundle" ? (
        <Card>
          <CardHeader title={t("catalog.bundle.title")} />
          <CardBody>
            <p className="mb-4 text-sm text-ink-muted">{t("catalog.bundle.intro")}</p>
            {components.length === 0 ? <p className="mb-4 text-sm text-ink-muted">{t("catalog.bundle.empty")}</p> : (
              <ul className="mb-4 grid list-none gap-2 p-0 text-sm">
                {components.map((component) => (
                  <li key={component.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-mono">{component.componentVariantId.slice(0, 8)}</span>
                    <span>× {component.quantity}</span>
                    <span className="text-ink-muted">{t(`catalog.bundle.mode.${component.priceMode}`)}</span>
                    <form action={productAction} className="ms-auto">
                      <input type="hidden" name="intent" value="removeComponent" />
                      <input type="hidden" name="id" value={product.id} />
                      <input type="hidden" name="expectedVersion" value={product.version} />
                      <input type="hidden" name="componentId" value={component.id} />
                      <Button type="submit" variant="quiet">{t("catalog.bundle.remove")}</Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            {otherVariants.length ? (
              <form action={productAction} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="intent" value="addComponent" />
                <input type="hidden" name="id" value={product.id} />
                <input type="hidden" name="expectedVersion" value={product.version} />
                <Field label={t("catalog.bundle.variant")} htmlFor="bundle-variant">
                  <Select id="bundle-variant" name="componentVariantId" required>
                    {otherVariants.map((variant) => <option key={variant.id} value={variant.id}>{variant.sku}</option>)}
                  </Select>
                </Field>
                <Field label={t("catalog.bundle.quantity")} htmlFor="bundle-qty"><Input id="bundle-qty" name="quantity" defaultValue="1" required /></Field>
                <Field label={t("catalog.bundle.modeLabel")} htmlFor="bundle-mode">
                  <Select id="bundle-mode" name="priceMode" required>
                    {BUNDLE_PRICE_MODES.map((mode) => <option key={mode} value={mode}>{t(`catalog.bundle.mode.${mode}`)}</option>)}
                  </Select>
                </Field>
                <Field label={t("catalog.bundle.fixedAmount")} htmlFor="bundle-amount"><Input id="bundle-amount" name="amount" inputMode="decimal" /></Field>
                <Field label={t("catalog.bundle.currency")} htmlFor="bundle-currency">
                  <Input id="bundle-currency" name="currency" maxLength={3} defaultValue={business?.baseCurrency ?? "USD"} className="font-mono uppercase" />
                </Field>
                <div><Button type="submit">{t("catalog.bundle.add")}</Button></div>
              </form>
            ) : <p className="text-sm text-ink-muted">{t("catalog.bundle.noVariants")}</p>}
          </CardBody>
        </Card>
      ) : null}

      {canManage && product.status !== "archived" ? (
        <Card>
          <CardHeader title={t("catalog.description")} />
          <CardBody>
            <ProductEditor
              id={product.id}
              initialVersion={product.version}
              initialBlocks={product.description}
              blockTypes={editorBlockTypes(t, "page", library.rows.map((asset) => ({ id: asset.id, filename: asset.filename })))}
              labels={editorLabels(t)}
            />
          </CardBody>
        </Card>
      ) : null}

      {canManage ? (
        <Card>
          <CardHeader icon={<Archive size={17} weight="bold" />} title={t("catalog.lifecycle")} />
          <CardBody>
            {product.status === "draft" ? (
              <div className="grid gap-5 sm:grid-cols-2">
                <form action={productAction} className="grid content-start gap-3">
                  <input type="hidden" name="intent" value="activate" /><input type="hidden" name="id" value={product.id} /><input type="hidden" name="expectedVersion" value={product.version} />
                  <p className="text-sm text-ink-muted">{product.taxCategoryId ? t("catalog.activateReady") : t("catalog.activateNeedsTax")}</p>
                  <div><Button type="submit">{t("catalog.activate")}</Button></div>
                </form>
                <LifecycleReasonForm productId={product.id} version={product.version} intent="archive" label={t("catalog.archive")} reasonLabel={t("catalog.archiveReason")} />
              </div>
            ) : product.status === "active" ? (
              <LifecycleReasonForm productId={product.id} version={product.version} intent="archive" label={t("catalog.archive")} reasonLabel={t("catalog.archiveReason")} />
            ) : (
              <LifecycleReasonForm productId={product.id} version={product.version} intent="restore" label={t("catalog.restore")} reasonLabel={t("catalog.restoreReason")} />
            )}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader icon={<ClockCounterClockwise size={17} weight="bold" />} title={t("catalog.history")} />
        <CardBody>
          <ol className="grid list-none gap-3 p-0">
            {history.map((event) => (
              <li key={event.id} className="flex flex-wrap items-center gap-2 border-b border-rule pb-3 text-sm last:border-0">
                <Pill>{t(`catalog.status.${event.toStatus}`)}</Pill>
                <span>{event.reason ?? t("catalog.historyChanged")}</span>
                <span className="ms-auto text-xs text-ink-muted">{formatDateTime(event.createdAt, timezone, locale)} · {event.actor}</span>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>
    </div>
  );
}

function LifecycleReasonForm({
  productId,
  version,
  intent,
  label,
  reasonLabel,
}: {
  productId: string;
  version: number;
  intent: "archive" | "restore";
  label: string;
  reasonLabel: string;
}) {
  return (
    <form action={productAction} className="grid gap-3">
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="id" value={productId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <Field label={reasonLabel} htmlFor={`${intent}-reason`}><Input id={`${intent}-reason`} name="reason" required minLength={3} maxLength={1000} /></Field>
      <div><Button type="submit" variant={intent === "archive" ? "danger" : "primary"}>{label}</Button></div>
    </form>
  );
}
