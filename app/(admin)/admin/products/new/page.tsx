// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { listProductTaxCategories } from "@/modules/catalog/service";
import { PRODUCT_KINDS, PRODUCT_VISIBILITIES } from "@/modules/catalog/contract";
import { Button, Callout, Card, CardBody, CardHeader, Field, Input, Select } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { productAction } from "../../../catalog-actions";
import { requireStaffActor } from "../../guard";

export const dynamic = "force-dynamic";

export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireStaffActor("catalog", "manage");
  const [categories, query, t] = await Promise.all([
    listProductTaxCategories.call({}, actor),
    searchParams,
    getT(),
  ]);
  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/products" className="text-sm text-ink-muted">{t("catalog.back")}</a>
        <h1 className="mt-2 text-xl font-bold tracking-tight">{t("catalog.new.title")}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t("catalog.new.intro")}</p>
      </div>
      {query.error ? (
        <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>{query.error}</Callout>
      ) : null}
      <Card>
        <CardHeader title={t("catalog.details")} />
        <CardBody>
          <form action={productAction} className="grid gap-5 sm:grid-cols-2">
            <input type="hidden" name="intent" value="create" />
            <Field label={t("catalog.name")} htmlFor="name"><Input id="name" name="name" required autoFocus maxLength={240} /></Field>
            <Field label={t("catalog.slug")} htmlFor="slug" hint={t("catalog.slugHint")}><Input id="slug" name="slug" required maxLength={180} className="font-mono" /></Field>
            <Field label={t("catalog.kind")} htmlFor="kind"><Select id="kind" name="kind" required>{PRODUCT_KINDS.map((kind) => <option key={kind} value={kind}>{t(`catalog.kind.${kind}`)}</option>)}</Select></Field>
            <Field label={t("catalog.visibility")} htmlFor="visibility"><Select id="visibility" name="visibility" required>{PRODUCT_VISIBILITIES.map((visibility) => <option key={visibility} value={visibility}>{t(`catalog.visibility.${visibility}`)}</option>)}</Select></Field>
            <Field label={t("catalog.subtitle")} htmlFor="subtitle"><Input id="subtitle" name="subtitle" maxLength={300} /></Field>
            <Field label={t("catalog.brand")} htmlFor="brand"><Input id="brand" name="brand" maxLength={200} /></Field>
            <Field label={t("catalog.taxCategory")} htmlFor="taxCategoryId" hint={categories.length ? t("catalog.taxCategoryHint") : t("catalog.taxCategoryEmpty")}>
              <Select id="taxCategoryId" name="taxCategoryId"><option value="">{t("catalog.taxCategoryUnset")}</option>{categories.map((category) => <option key={category.id} value={category.id} disabled={!category.active}>{category.name} ({category.code}){category.active ? "" : ` — ${t("catalog.taxCategoryInactive")}`}</option>)}</Select>
            </Field>
            <div className="self-end"><Button type="submit">{t("catalog.create")}</Button></div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
