// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Staff findability across user-owned records (C11.14). The page requires the
// search grant; hits are then filtered by each source's module.
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader } from "@/ui/primitives";
import { querySearch } from "@/core/search/service";
import { ServiceError } from "@/core/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const KIND_KEYS: Record<string, string> = {
  order: "admin.search.kind.order",
  subscription: "admin.search.kind.subscription",
  giftRegistry: "admin.search.kind.giftRegistry",
  contact: "admin.search.kind.contact",
  conversation: "admin.search.kind.conversation",
  deal: "admin.search.kind.deal",
  document: "admin.search.kind.document",
  note: "admin.search.kind.note",
  task: "admin.search.kind.task",
  invoice: "admin.search.kind.invoice",
  page: "admin.search.kind.page",
  media: "admin.search.kind.media",
  product: "admin.search.kind.product",
  quote: "admin.search.kind.quote",
  project: "admin.search.kind.project",
  gallery: "admin.search.kind.gallery",
};

export default async function AdminSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const actor = await requireStaffActor("search");
  const query = await searchParams;
  const q = query.q?.trim() ?? "";
  const t = await getT();

  let hits: Awaited<ReturnType<typeof querySearch.call>> | null = null;
  let error: string | null = null;
  if (q) {
    try {
      hits = await querySearch.call({ q, limit: 20 }, actor);
    } catch (caught) {
      if (caught instanceof ServiceError) {
        error = t("admin.search.failed");
        hits = [];
      } else {
        throw caught;
      }
    }
  }

  const groups = new Map<string, NonNullable<typeof hits>>();
  for (const hit of hits ?? []) {
    const list = groups.get(hit.kind) ?? [];
    list.push(hit);
    groups.set(hit.kind, list);
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("admin.search.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("admin.search.intro")}</p>
      </div>

      <Card>
        <CardBody>
          <form method="get" action="/admin/search" className="flex flex-wrap items-end gap-3">
            <label className="grid grow gap-1 text-sm" htmlFor="record-query">
              <span className="text-ink-muted">{t("admin.search.field.query")}</span>
              <input
                id="record-query"
                name="q"
                defaultValue={q}
                maxLength={200}
                className="w-full rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <Button type="submit">{t("admin.search.action")}</Button>
          </form>
        </CardBody>
      </Card>

      {error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {q === "" ? (
        <Card>
          <CardBody>
            <p className="max-w-prose text-sm text-ink-muted">{t("admin.search.empty")}</p>
          </CardBody>
        </Card>
      ) : hits && hits.length === 0 && !error ? (
        <Card>
          <CardBody>
            <p className="max-w-prose text-sm text-ink-muted">{t("admin.search.noResults")}</p>
          </CardBody>
        </Card>
      ) : (
        [...groups.entries()].map(([kind, rows]) => (
          <Card key={kind}>
            <CardHeader title={t(KIND_KEYS[kind] ?? "admin.search.kind.other")} />
            <CardBody>
              <ul className="grid list-none gap-2 p-0">
                {rows.map((hit) => (
                  <li key={`${hit.kind}:${hit.id}`}>
                    <a
                      href={hit.href}
                      className="block rounded-md border border-rule p-3 text-sm hover:bg-surface-muted"
                    >
                      <span className="font-medium text-ink">{hit.title}</span>
                      {hit.snippet ? (
                        <span className="mt-1 block text-ink-muted">{hit.snippet}</span>
                      ) : null}
                    </a>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ))
      )}
    </div>
  );
}
