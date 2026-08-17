// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Suppliers, purchase orders and receiving (C5.17).

import { Truck, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { listContacts } from "@/core/contacts/service";
import { listLocations } from "@/core/locations/service";
import { currentBusiness } from "@/core/settings/read";
import { hasModuleAccess } from "@/core/service";
import {
  listPurchaseOrders,
  listReorderQueue,
  listSuppliers,
  listTrackedVariantChoices,
} from "@/modules/catalog/service";
import { Button, Callout, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { productAction } from "../../catalog-actions";
import { requireStaffActor } from "../guard";

export const dynamic = "force-dynamic";

export default async function ProcurementPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; order?: string }>;
}) {
  const actor = await requireStaffActor("catalog");
  const query = await searchParams;
  const [suppliers, orders, reorder, variants, locations, contacts, business, t] = await Promise.all([
    listSuppliers.call({}, actor),
    listPurchaseOrders.call({}, actor),
    listReorderQueue.call({}, actor),
    listTrackedVariantChoices.call({}, actor),
    listLocations.call({}, actor),
    listContacts.call({ limit: 80 }, actor).catch(() => ({ rows: [] as Array<{ id: string; name: string }> })),
    currentBusiness(),
    getT(),
  ]);
  const canManage = hasModuleAccess(actor, "catalog", "manage");
  const selected = query.order ? orders.find((row) => row.id === query.order) : orders[0];

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <Truck size={22} weight="duotone" className="text-accent" />
          {t("catalog.procure.title")}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("catalog.procure.intro")}</p>
      </div>
      {query.error ? <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>{query.error}</Callout> : null}
      {query.saved ? <Callout tone="success">{t(`catalog.saved.${query.saved}`)}</Callout> : null}

      <Card>
        <CardHeader title={t("catalog.procure.reorder")} />
        <CardBody>
          {reorder.length === 0 ? <p className="text-sm text-ink-muted">{t("catalog.procure.reorderEmpty")}</p> : (
            <ul className="grid list-none gap-2 p-0 text-sm">
              {reorder.map((row) => (
                <li key={row.id}>
                  <a href={`/admin/inventory?item=${row.id}`}>{row.productName} · {row.sku}</a>
                  {" · "}
                  {t("catalog.inventory.onHandCount", { count: row.onHand })}
                  {" · "}
                  {t("catalog.procure.incomingCount", { count: row.incoming })}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("catalog.procure.suppliers")} />
        <CardBody>
          {suppliers.length === 0 ? <p className="mb-4 text-sm text-ink-muted">{t("catalog.procure.suppliersEmpty")}</p> : (
            <ul className="mb-4 grid list-none gap-2 p-0 text-sm">
              {suppliers.map((row) => (
                <li key={row.id}>{row.name} · {row.currency} · {t("catalog.procure.leadTime", { days: row.leadTimeDays })}</li>
              ))}
            </ul>
          )}
          {canManage ? (
            <form action={productAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="intent" value="createSupplier" />
              <Field label={t("catalog.procure.supplierName")} htmlFor="sup-name"><Input id="sup-name" name="name" required /></Field>
              <Field label={t("catalog.procure.supplierCurrency")} htmlFor="sup-cur">
                <Input id="sup-cur" name="currency" maxLength={3} defaultValue={business?.baseCurrency ?? "CAD"} className="font-mono uppercase" required />
              </Field>
              <Field label={t("catalog.procure.leadDays")} htmlFor="sup-lead"><Input id="sup-lead" name="leadTimeDays" inputMode="numeric" defaultValue={7} /></Field>
              <Field label={t("catalog.procure.supplierContact")} htmlFor="sup-contact">
                <Select id="sup-contact" name="contactId">
                  <option value="">{t("catalog.procure.noContact")}</option>
                  {contacts.rows.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </Select>
              </Field>
              <div><Button type="submit">{t("catalog.procure.createSupplier")}</Button></div>
            </form>
          ) : null}
        </CardBody>
      </Card>

      {canManage && suppliers.length && locations.length ? (
        <Card>
          <CardHeader title={t("catalog.procure.newOrder")} />
          <CardBody>
            <form action={productAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="intent" value="createPO" />
              <Field label={t("catalog.procure.supplier")} htmlFor="po-sup">
                <Select id="po-sup" name="supplierId" required>
                  {suppliers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </Select>
              </Field>
              <Field label={t("catalog.procure.receiveAt")} htmlFor="po-loc">
                <Select id="po-loc" name="locationId" required>
                  {locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </Select>
              </Field>
              <div><Button type="submit">{t("catalog.procure.createOrder")}</Button></div>
            </form>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t("catalog.procure.orders")} />
        <CardBody>
          {orders.length === 0 ? <p className="text-sm text-ink-muted">{t("catalog.procure.ordersEmpty")}</p> : (
            <ul className="mb-4 grid list-none gap-2 p-0 text-sm">
              {orders.map((order) => (
                <li key={order.id}>
                  <a href={`/admin/procurement?order=${order.id}`}>{order.id.slice(0, 8)}</a>
                  {" · "}
                  <Pill>{t(`catalog.procure.status.${order.status}`)}</Pill>
                  {" · "}
                  {order.currency}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {selected && canManage ? (
        <Card>
          <CardHeader title={t("catalog.procure.orderTitle", { id: selected.id.slice(0, 8) })} />
          <CardBody>
            <p className="mb-4 text-sm text-ink-muted">
              {t(`catalog.procure.status.${selected.status}`)} · {selected.currency}
            </p>
            {selected.lines.length === 0 ? <p className="mb-4 text-sm text-ink-muted">{t("catalog.procure.linesEmpty")}</p> : (
              <ul className="mb-4 grid list-none gap-3 p-0">
                {selected.lines.map((line) => (
                  <li key={line.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono">{line.variantId.slice(0, 8)}</span>
                    <span>{line.receivedQty}/{line.quantity}</span>
                    {selected.status === "ordered" || selected.status === "partial" ? (
                      <form action={productAction} className="ms-auto flex flex-wrap items-end gap-2">
                        <input type="hidden" name="intent" value="receivePOLine" />
                        <input type="hidden" name="lineId" value={line.id} />
                        <input type="hidden" name="purchaseOrderId" value={selected.id} />
                        <Field label={t("catalog.procure.receiveQty")} htmlFor={`recv-${line.id}`}>
                          <Input id={`recv-${line.id}`} name="quantity" inputMode="numeric" defaultValue={String(line.quantity - line.receivedQty)} required />
                        </Field>
                        <Button type="submit">{t("catalog.procure.receive")}</Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {selected.status === "draft" ? (
              <form action={productAction} className="mb-4 grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="intent" value="addPOLine" />
                <input type="hidden" name="purchaseOrderId" value={selected.id} />
                <Field label={t("catalog.inventory.variant")} htmlFor="pol-var">
                  <Select id="pol-var" name="variantId" required>
                    {variants.map((row) => <option key={row.id} value={row.id}>{row.productName} · {row.sku}</option>)}
                  </Select>
                </Field>
                <Field label={t("catalog.procure.qty")} htmlFor="pol-qty"><Input id="pol-qty" name="quantity" inputMode="numeric" defaultValue="1" required /></Field>
                <Field label={t("catalog.procure.unitCost")} htmlFor="pol-cost"><Input id="pol-cost" name="unitCost" inputMode="decimal" required /></Field>
                <div className="self-end"><Button type="submit">{t("catalog.procure.addLine")}</Button></div>
              </form>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {selected.status === "draft" ? (
                <form action={productAction}>
                  <input type="hidden" name="intent" value="placePO" />
                  <input type="hidden" name="purchaseOrderId" value={selected.id} />
                  <Button type="submit">{t("catalog.procure.place")}</Button>
                </form>
              ) : null}
              {selected.status === "draft" || selected.status === "ordered" || selected.status === "partial" ? (
                <form action={productAction}>
                  <input type="hidden" name="intent" value="cancelPO" />
                  <input type="hidden" name="purchaseOrderId" value={selected.id} />
                  <Button type="submit" variant="danger">{t("catalog.procure.cancel")}</Button>
                </form>
              ) : null}
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
