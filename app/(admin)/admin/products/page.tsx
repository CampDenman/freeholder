// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner catalog index over the same lifecycle services exposed to API/MCP.

import { Package, Plus } from "@phosphor-icons/react/dist/ssr";
import { listProducts } from "@/modules/catalog/service";
import {
  PRODUCT_KINDS,
  PRODUCT_STATUSES,
  PRODUCT_VISIBILITIES,
} from "@/modules/catalog/contract";
import { Card, CardBody, Pill, Select } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";

export const dynamic = "force-dynamic";

function oneOf<T extends readonly string[]>(value: string | undefined, values: T) {
  return values.includes(value as T[number]) ? (value as T[number]) : undefined;
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; kind?: string; visibility?: string }>;
}) {
  const actor = await requireStaffActor("catalog");
  const query = await searchParams;
  const filters = {
    status: oneOf(query.status, PRODUCT_STATUSES),
    kind: oneOf(query.kind, PRODUCT_KINDS),
    visibility: oneOf(query.visibility, PRODUCT_VISIBILITIES),
  };
  const [rows, t] = await Promise.all([
    listProducts.call(filters, actor),
    getT(),
  ]);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <Package size={22} weight="duotone" className="text-accent" />
            {t("catalog.title")}
          </h1>
          <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("catalog.intro")}</p>
        </div>
        <a
          href="/admin/products/new"
          className="ms-auto inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent"
        >
          <Plus size={16} weight="bold" />
          {t("catalog.add")}
        </a>
      </div>

      <form className="grid gap-3 rounded-lg border border-rule bg-surface p-4 sm:grid-cols-4">
        <Select name="status" defaultValue={filters.status ?? ""} aria-label={t("catalog.status")}>
          <option value="">{t("catalog.filter.allStatuses")}</option>
          {PRODUCT_STATUSES.map((status) => (
            <option key={status} value={status}>{t(`catalog.status.${status}`)}</option>
          ))}
        </Select>
        <Select name="kind" defaultValue={filters.kind ?? ""} aria-label={t("catalog.kind")}>
          <option value="">{t("catalog.filter.allKinds")}</option>
          {PRODUCT_KINDS.map((kind) => (
            <option key={kind} value={kind}>{t(`catalog.kind.${kind}`)}</option>
          ))}
        </Select>
        <Select name="visibility" defaultValue={filters.visibility ?? ""} aria-label={t("catalog.visibility")}>
          <option value="">{t("catalog.filter.allVisibility")}</option>
          {PRODUCT_VISIBILITIES.map((visibility) => (
            <option key={visibility} value={visibility}>{t(`catalog.visibility.${visibility}`)}</option>
          ))}
        </Select>
        <button className="rounded-md border border-rule px-4 py-2 text-sm font-semibold" type="submit">
          {t("catalog.filter.apply")}
        </button>
      </form>

      {rows.length === 0 ? (
        <Card><CardBody><p className="text-sm text-ink-muted">{t("catalog.empty")}</p></CardBody></Card>
      ) : (
        <ul className="grid list-none gap-3 p-0">
          {rows.map((product) => (
            <li key={product.id}>
              <a
                href={`/admin/products/${product.id}`}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-rule bg-surface px-4 py-4 hover:border-accent"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">{product.name}</p>
                  <p className="mt-1 font-mono text-xs text-ink-muted">{t("catalog.pathPrefix")}{product.slug}</p>
                </div>
                <Pill tone={product.status === "active" ? "success" : product.status === "archived" ? "neutral" : "warning"}>
                  {t(`catalog.status.${product.status}`)}
                </Pill>
                <Pill>{t(`catalog.kind.${product.kind}`)}</Pill>
                <span className="text-xs text-ink-muted">{t(`catalog.visibility.${product.visibility}`)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
