// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Return / RMA queue (C5.19).

import { randomUUID } from "node:crypto";
import { ArrowUUpLeft, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { listLocations } from "@/core/locations/service";
import { hasModuleAccess } from "@/core/service";
import { RETURN_STATUSES } from "@/modules/catalog/contract";
import { getReturn, listReturns } from "@/modules/catalog/service";
import { Button, Callout, Card, CardBody, CardHeader, Field, Pill, Select } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { productAction } from "../../catalog-actions";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";

export const dynamic = "force-dynamic";

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; id?: string; status?: string }>;
}) {
  const actor = await requireStaffActor("catalog");
  const query = await searchParams;
  const status = RETURN_STATUSES.includes(query.status as (typeof RETURN_STATUSES)[number])
    ? (query.status as (typeof RETURN_STATUSES)[number])
    : undefined;
  const [rows, locations, t] = await Promise.all([
    listReturns.call({ ...(status ? { status } : {}) }, actor),
    listLocations.call({}, actor),
    getT(),
  ]);
  const selected = query.id ? await domainOrNull(getReturn.call({ id: query.id }, actor)) : null;
  const canManage = hasModuleAccess(actor, "catalog", "manage");

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <ArrowUUpLeft size={22} weight="duotone" className="text-accent" />
          {t("catalog.returns.title")}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("catalog.returns.intro")}</p>
      </div>
      {query.error ? <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>{query.error}</Callout> : null}
      {query.saved ? <Callout tone="success">{t(`catalog.saved.${query.saved}`)}</Callout> : null}

      <form className="grid gap-3 rounded-lg border border-rule bg-surface p-4 sm:grid-cols-[1fr_auto]">
        <Select name="status" defaultValue={status ?? ""} aria-label={t("catalog.returns.filter")}>
          <option value="">{t("catalog.returns.filterAll")}</option>
          {RETURN_STATUSES.map((value) => (
            <option key={value} value={value}>{t(`catalog.returns.status.${value}`)}</option>
          ))}
        </Select>
        <button className="rounded-md border border-rule px-4 py-2 text-sm font-semibold" type="submit">
          {t("catalog.returns.filter")}
        </button>
      </form>

      <Card>
        <CardHeader title={t("catalog.returns.queue")} />
        <CardBody>
          {rows.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("catalog.returns.empty")}</p>
          ) : (
            <ul className="grid list-none gap-3 p-0 text-sm">
              {rows.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-2">
                  <a href={`/admin/returns?id=${row.id}`} className="font-semibold hover:text-accent">
                    {row.id.slice(0, 8)}
                  </a>
                  <Pill>{t(`catalog.returns.status.${row.status}`)}</Pill>
                  <a href={`/admin/orders/${row.orderId}`} className="text-ink-muted">{t("catalog.returns.order")}</a>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {selected ? (
        <Card>
          <CardHeader title={t("catalog.returns.detail")} />
          <CardBody>
            <p className="mb-3 text-sm">{selected.return.reason}</p>
            <ul className="mb-4 grid list-none gap-2 p-0 text-sm">
              {selected.items.map((item) => (
                <li key={item.id}>
                  {item.quantity} · {item.orderItemId.slice(0, 8)}
                  {item.restockedQuantity ? ` · ${t("catalog.returns.restocked", { count: item.restockedQuantity })}` : ""}
                </li>
              ))}
            </ul>
            {canManage && selected.return.status === "requested" ? (
              <div className="flex flex-wrap gap-3">
                <form action={productAction}>
                  <input type="hidden" name="intent" value="decideReturn" />
                  <input type="hidden" name="id" value={selected.return.id} />
                  <input type="hidden" name="decision" value="approved" />
                  <input type="hidden" name="returnTo" value={`/admin/returns?id=${selected.return.id}`} />
                  <Button type="submit">{t("catalog.returns.approve")}</Button>
                </form>
                <form action={productAction}>
                  <input type="hidden" name="intent" value="decideReturn" />
                  <input type="hidden" name="id" value={selected.return.id} />
                  <input type="hidden" name="decision" value="rejected" />
                  <input type="hidden" name="returnTo" value={`/admin/returns?id=${selected.return.id}`} />
                  <Button type="submit">{t("catalog.returns.reject")}</Button>
                </form>
              </div>
            ) : null}
            {canManage && selected.return.status === "approved" ? (
              <form action={productAction} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="intent" value="receiveReturn" />
                <input type="hidden" name="id" value={selected.return.id} />
                <input type="hidden" name="returnTo" value={`/admin/returns?id=${selected.return.id}`} />
                <Field label={t("catalog.returns.location")} htmlFor="ret-loc">
                  <Select id="ret-loc" name="locationId">
                    <option value="">{t("catalog.returns.anyLocation")}</option>
                    {locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                  </Select>
                </Field>
                <div><Button type="submit">{t("catalog.returns.receive")}</Button></div>
              </form>
            ) : null}
            {canManage && selected.return.status === "received" ? (
              <form action={productAction}>
                <input type="hidden" name="intent" value="refundReturn" />
                <input type="hidden" name="id" value={selected.return.id} />
                <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                <input type="hidden" name="returnTo" value={`/admin/returns?id=${selected.return.id}`} />
                <Button type="submit">{t("catalog.returns.refund")}</Button>
              </form>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
