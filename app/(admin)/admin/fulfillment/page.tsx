// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Fulfillment queue and failed shipments (C5.19).

import { AirplaneTakeoff, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { listContacts } from "@/core/contacts/service";
import { listFulfillmentQueue, listFulfillments } from "@/modules/catalog/service";
import { Callout, Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { money } from "../invoices/format";

export const dynamic = "force-dynamic";

export default async function FulfillmentPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const actor = await requireStaffActor("catalog");
  const query = await searchParams;
  const [queue, failed, contacts, t] = await Promise.all([
    listFulfillmentQueue.call({}, actor),
    listFulfillments.call({ status: "failed" }, actor),
    listContacts.call({ limit: 80 }, actor).catch(() => ({ rows: [] as Array<{ id: string; name: string }> })),
    getT(),
  ]);
  const names = new Map(contacts.rows.map((row) => [row.id, row.name]));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <AirplaneTakeoff size={22} weight="duotone" className="text-accent" />
          {t("catalog.fulfill.title")}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("catalog.fulfill.intro")}</p>
      </div>
      {query.error ? <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>{query.error}</Callout> : null}
      {query.saved ? <Callout tone="success">{t(`catalog.saved.${query.saved}`)}</Callout> : null}

      <Card>
        <CardHeader title={t("catalog.fulfill.queue")} />
        <CardBody>
          {queue.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("catalog.fulfill.queueEmpty")}</p>
          ) : (
            <ul className="grid list-none gap-3 p-0 text-sm">
              {queue.map((order) => (
                <li key={order.id} className="flex flex-wrap items-center gap-2">
                  <a href={`/admin/orders/${order.id}`} className="font-semibold hover:text-accent">
                    {order.id.slice(0, 8)}
                  </a>
                  <Pill>{t(`catalog.orders.status.${order.status}`)}</Pill>
                  <span>{names.get(order.contactId) ?? order.contactId}</span>
                  <span className="ms-auto font-mono">{money(order.totalMinor, order.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("catalog.fulfill.exceptions")} />
        <CardBody>
          {failed.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("catalog.fulfill.exceptionsEmpty")}</p>
          ) : (
            <ul className="grid list-none gap-3 p-0 text-sm">
              {failed.map((row) => (
                <li key={row.id}>
                  <a href={`/admin/orders/${row.orderId}`} className="font-semibold hover:text-accent">
                    {row.id.slice(0, 8)}
                  </a>
                  {" · "}
                  <Pill>{t(`catalog.fulfill.status.${row.status}`)}</Pill>
                  {row.note ? ` · ${row.note}` : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
