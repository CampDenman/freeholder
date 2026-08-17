// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One order: pay after the invoice settles, or cancel while unpaid (C5.22).

import { notFound } from "next/navigation";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { getContact } from "@/core/contacts/service";
import { listLocations } from "@/core/locations/service";
import { hasModuleAccess, ServiceError } from "@/core/service";
import {
  getFulfillment,
  getOrder,
  listDigitalDeliveries,
  listFulfillments,
  listReturns,
} from "@/modules/catalog/service";
import { Button, Callout, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { productAction } from "../../../catalog-actions";
import { requireStaffActor } from "../../guard";
import { money } from "../../invoices/format";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const actor = await requireStaffActor("catalog");
  const { id } = await params;
  const query = await searchParams;
  const bundle = await getOrder.call({ id }, actor).catch((error: unknown) => {
    if (error instanceof ServiceError && error.code === "not_found") notFound();
    throw error;
  });
  const [contact, locations, ships, grants, returns, t] = await Promise.all([
    getContact.call({ id: bundle.order.contactId }, actor).catch(() => null),
    listLocations.call({}, actor),
    listFulfillments.call({ orderId: id }, actor),
    listDigitalDeliveries.call({ orderId: id }, actor),
    listReturns.call({ orderId: id }, actor),
    getT(),
  ]);
  const detailed = await Promise.all(ships.map((row) => getFulfillment.call({ id: row.id }, actor)));
  const allocated = new Map<string, number>();
  for (const ship of detailed) {
    if (ship.fulfillment.status === "failed" || ship.fulfillment.status === "returned") continue;
    for (const item of ship.items) {
      allocated.set(item.orderItemId, (allocated.get(item.orderItemId) ?? 0) + item.quantity);
    }
  }
  const canManage = hasModuleAccess(actor, "catalog", "manage");
  const order = bundle.order;
  const canFulfill = canManage && (order.status === "paid" || order.status === "fulfilling");
  const canReturn = canManage && ["paid", "fulfilling", "fulfilled"].includes(order.status);

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/orders" className="text-sm text-ink-muted">{t("catalog.orders.back")}</a>
        <h1 className="mt-2 flex flex-wrap items-center gap-3 text-xl font-bold tracking-tight">
          {order.id.slice(0, 8)}
          <Pill>{t(`catalog.orders.status.${order.status}`)}</Pill>
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {contact ? (
            <a href={`/admin/contacts/${contact.id}`} className="font-semibold text-ink hover:text-accent">
              {contact.name}
            </a>
          ) : order.contactId}{" "}
          · {money(order.totalMinor, order.currency)}
        </p>
      </div>
      {query.error ? <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>{query.error}</Callout> : null}
      {query.saved ? <Callout tone="success">{t(`catalog.saved.${query.saved}`)}</Callout> : null}

      <Card>
        <CardHeader title={t("catalog.orders.lines")} />
        <CardBody>
          <ul className="mb-4 grid list-none gap-2 p-0 text-sm">
            {bundle.lines.map((line) => {
              const snap = line.snapshot as { sku?: string; productName?: string };
              return (
                <li key={line.id} className="flex flex-wrap gap-2">
                  <span className="font-semibold">{snap.productName ?? line.variantId} · {snap.sku}</span>
                  <span>× {line.quantity}</span>
                  <span className="ms-auto font-mono">{money(line.lineTotalMinor, order.currency)}</span>
                </li>
              );
            })}
          </ul>
          <p className="text-sm">{t("catalog.orders.subtotal")} {money(order.subtotalMinor, order.currency)}</p>
          <p className="text-sm">{t("catalog.orders.shipping")} {money(order.shippingMinor, order.currency)}</p>
          <p className="text-sm">{t("catalog.orders.tax")} {money(order.taxMinor, order.currency)}</p>
          <p className="text-sm font-semibold">{t("catalog.orders.total")} {money(order.totalMinor, order.currency)}</p>
          {order.invoiceId ? (
            <p className="mt-3 text-sm">
              <a href={`/admin/invoices/${order.invoiceId}`} className="font-semibold text-accent">
                {t("catalog.orders.invoice")}
              </a>
            </p>
          ) : null}
        </CardBody>
      </Card>

      {grants.length ? (
        <Card>
          <CardHeader title={t("catalog.fulfill.digital")} />
          <CardBody>
            <ul className="grid list-none gap-2 p-0 text-sm">
              {grants.map((grant) => (
                <li key={grant.id} className="font-mono">{grant.token}</li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t("catalog.fulfill.shipments")} />
        <CardBody>
          {detailed.length === 0 ? (
            <p className="mb-4 text-sm text-ink-muted">{t("catalog.fulfill.none")}</p>
          ) : (
            <ul className="mb-4 grid list-none gap-3 p-0 text-sm">
              {detailed.map(({ fulfillment, items }) => (
                <li key={fulfillment.id} className="grid gap-2 border-b border-rule pb-3 last:border-b-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill>{t(`catalog.fulfill.status.${fulfillment.status}`)}</Pill>
                    {fulfillment.trackingNumber ? <span className="font-mono">{fulfillment.trackingNumber}</span> : null}
                    <span>{t("catalog.fulfill.itemCount", { count: items.length })}</span>
                  </div>
                  {canManage && ["pending", "picking", "packed"].includes(fulfillment.status) ? (
                    <div className="flex flex-wrap gap-2">
                      {fulfillment.status !== "packed" ? (
                        <form action={productAction}>
                          <input type="hidden" name="intent" value="packFulfillment" />
                          <input type="hidden" name="id" value={fulfillment.id} />
                          <input type="hidden" name="orderId" value={order.id} />
                          <input type="hidden" name="returnTo" value={`/admin/orders/${order.id}`} />
                          <Button type="submit">{t("catalog.fulfill.pack")}</Button>
                        </form>
                      ) : null}
                      <form action={productAction} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="intent" value="shipFulfillment" />
                        <input type="hidden" name="id" value={fulfillment.id} />
                        <input type="hidden" name="orderId" value={order.id} />
                        <input type="hidden" name="returnTo" value={`/admin/orders/${order.id}`} />
                        <Field label={t("catalog.fulfill.carrier")} htmlFor={`carrier-${fulfillment.id}`}>
                          <Input id={`carrier-${fulfillment.id}`} name="carrier" />
                        </Field>
                        <Field label={t("catalog.fulfill.tracking")} htmlFor={`track-${fulfillment.id}`}>
                          <Input id={`track-${fulfillment.id}`} name="trackingNumber" />
                        </Field>
                        <Button type="submit">{t("catalog.fulfill.ship")}</Button>
                      </form>
                      <form action={productAction} className="flex items-end gap-2">
                        <input type="hidden" name="intent" value="failFulfillment" />
                        <input type="hidden" name="id" value={fulfillment.id} />
                        <input type="hidden" name="orderId" value={order.id} />
                        <input type="hidden" name="returnTo" value={`/admin/orders/${order.id}`} />
                        <Field label={t("catalog.fulfill.failNote")} htmlFor={`fail-${fulfillment.id}`}>
                          <Input id={`fail-${fulfillment.id}`} name="note" required />
                        </Field>
                        <Button type="submit">{t("catalog.fulfill.fail")}</Button>
                      </form>
                    </div>
                  ) : null}
                  {canManage && fulfillment.status === "shipped" ? (
                    <form action={productAction}>
                      <input type="hidden" name="intent" value="deliverFulfillment" />
                      <input type="hidden" name="id" value={fulfillment.id} />
                      <input type="hidden" name="orderId" value={order.id} />
                      <input type="hidden" name="returnTo" value={`/admin/orders/${order.id}`} />
                      <Button type="submit">{t("catalog.fulfill.deliver")}</Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canFulfill ? (
            <form action={productAction} className="grid gap-3">
              <input type="hidden" name="intent" value="createFulfillment" />
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="returnTo" value={`/admin/orders/${order.id}`} />
              <Field label={t("catalog.fulfill.location")} htmlFor="ful-loc">
                <Select id="ful-loc" name="locationId">
                  <option value="">{t("catalog.fulfill.noLocation")}</option>
                  {locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </Select>
              </Field>
              {bundle.lines.map((line) => {
                const remaining = line.quantity - (allocated.get(line.id) ?? 0);
                const snap = line.snapshot as { sku?: string; productName?: string; requiresShipping?: boolean };
                if (remaining <= 0 || snap.requiresShipping === false) return null;
                return (
                  <div key={line.id} className="grid gap-2 sm:grid-cols-[1fr_8rem]">
                    <input type="hidden" name="orderItemId" value={line.id} />
                    <span className="text-sm">{snap.productName ?? line.variantId} · {snap.sku}</span>
                    <Field label={t("catalog.fulfill.quantity")} htmlFor={`qty-${line.id}`}>
                      <Input id={`qty-${line.id}`} name="quantity" inputMode="numeric" defaultValue={String(remaining)} />
                    </Field>
                  </div>
                );
              })}
              <div><Button type="submit">{t("catalog.fulfill.create")}</Button></div>
            </form>
          ) : null}
        </CardBody>
      </Card>

      {canReturn ? (
        <Card>
          <CardHeader title={t("catalog.returns.open")} />
          <CardBody>
            {returns.length ? (
              <ul className="mb-4 grid list-none gap-2 p-0 text-sm">
                {returns.map((row) => (
                  <li key={row.id}>
                    <a href={`/admin/returns?id=${row.id}`} className="font-semibold hover:text-accent">
                      {row.id.slice(0, 8)}
                    </a>
                    {" · "}
                    <Pill>{t(`catalog.returns.status.${row.status}`)}</Pill>
                  </li>
                ))}
              </ul>
            ) : null}
            <form action={productAction} className="grid gap-3">
              <input type="hidden" name="intent" value="requestReturn" />
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="returnTo" value={`/admin/orders/${order.id}`} />
              <Field label={t("catalog.returns.reason")} htmlFor="ret-reason">
                <Input id="ret-reason" name="reason" required />
              </Field>
              {bundle.lines.map((line) => {
                const snap = line.snapshot as { sku?: string; productName?: string };
                return (
                  <div key={line.id} className="grid gap-2 sm:grid-cols-[1fr_8rem]">
                    <input type="hidden" name="orderItemId" value={line.id} />
                    <span className="text-sm">{snap.productName ?? line.variantId} · {snap.sku}</span>
                    <Field label={t("catalog.returns.quantity")} htmlFor={`ret-qty-${line.id}`}>
                      <Input id={`ret-qty-${line.id}`} name="quantity" inputMode="numeric" defaultValue={String(line.quantity)} />
                    </Field>
                  </div>
                );
              })}
              <div><Button type="submit">{t("catalog.returns.request")}</Button></div>
            </form>
          </CardBody>
        </Card>
      ) : null}

      {canManage && order.status === "pending_payment" ? (
        <Card>
          <CardHeader title={t("catalog.orders.pay")} />
          <CardBody>
            <div className="flex flex-wrap gap-3">
              <form action={productAction}>
                <input type="hidden" name="intent" value="payOrder" />
                <input type="hidden" name="id" value={order.id} />
                <input type="hidden" name="returnTo" value={`/admin/orders/${order.id}`} />
                <Button type="submit">{t("catalog.orders.pay")}</Button>
              </form>
              <form action={productAction}>
                <input type="hidden" name="intent" value="cancelOrder" />
                <input type="hidden" name="id" value={order.id} />
                <input type="hidden" name="returnTo" value={`/admin/orders/${order.id}`} />
                <Button type="submit">{t("catalog.orders.cancel")}</Button>
              </form>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
