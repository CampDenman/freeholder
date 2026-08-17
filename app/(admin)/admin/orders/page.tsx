// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Order list (C5.22).

import { ClipboardText, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { listContacts } from "@/core/contacts/service";
import { listOrders } from "@/modules/catalog/service";
import { Callout, Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { money } from "../invoices/format";

export const dynamic = "force-dynamic";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const actor = await requireStaffActor("catalog");
  const query = await searchParams;
  const [rows, contacts, t] = await Promise.all([
    listOrders.call({}, actor),
    listContacts.call({ limit: 80 }, actor).catch(() => ({ rows: [] as Array<{ id: string; name: string }> })),
    getT(),
  ]);
  const names = new Map(contacts.rows.map((row) => [row.id, row.name]));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <ClipboardText size={22} weight="duotone" className="text-accent" />
          {t("catalog.orders.title")}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("catalog.orders.intro")}</p>
      </div>
      {query.error ? <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>{query.error}</Callout> : null}
      {query.saved ? <Callout tone="success">{t(`catalog.saved.${query.saved}`)}</Callout> : null}

      <Card>
        <CardHeader title={t("catalog.orders.title")} />
        <CardBody>
          {rows.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("catalog.orders.empty")}</p>
          ) : (
            <ul className="grid list-none gap-3 p-0 text-sm">
              {rows.map((order) => (
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
    </div>
  );
}
