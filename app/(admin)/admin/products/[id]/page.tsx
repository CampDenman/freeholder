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
import { getProduct, listProductTaxCategories } from "@/modules/catalog/service";
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
  const [bundle, categories, query, business, t] = await Promise.all([
    getProduct.call({ id }, actor).catch((error: unknown) => {
      if (error instanceof ServiceError) notFound();
      throw error;
    }),
    listProductTaxCategories.call({}, actor),
    searchParams,
    currentBusiness(),
    getT(),
  ]);
  const canManage = hasModuleAccess(actor, "catalog", "manage");
  const library = canManage && hasModuleAccess(actor, "media")
    ? await listAssets.call({ kind: "image" }, actor)
    : { rows: [] };
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
