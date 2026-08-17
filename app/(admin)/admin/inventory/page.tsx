// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Inventory ledger, count, adjustment and transfer workspace (C5.16).

import { Stack, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { listLocations } from "@/core/locations/service";
import { hasModuleAccess } from "@/core/service";
import { BACKORDER_POLICIES } from "@/modules/catalog/contract";
import {
  listInventory,
  listReorderQueue,
  listStockMovements,
  listTrackedVariantChoices,
} from "@/modules/catalog/service";
import { Button, Callout, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { productAction } from "../../catalog-actions";
import { requireStaffActor } from "../guard";

export const dynamic = "force-dynamic";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; item?: string }>;
}) {
  const actor = await requireStaffActor("catalog");
  const query = await searchParams;
  const [items, variants, locations, reorder, t] = await Promise.all([
    listInventory.call({}, actor),
    listTrackedVariantChoices.call({}, actor),
    listLocations.call({ includeHidden: false }, actor),
    listReorderQueue.call({}, actor),
    getT(),
  ]);
  const canManage = hasModuleAccess(actor, "catalog", "manage");
  const selected = query.item ? items.find((row) => row.id === query.item) : null;
  const movements = selected
    ? await listStockMovements.call({ itemId: selected.id, limit: 50 }, actor)
    : [];
  const hideLocation = locations.length <= 1;
  const onlyLocation = locations[0];

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <Stack size={22} weight="duotone" className="text-accent" />
          {t("catalog.inventory.title")}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("catalog.inventory.intro")}</p>
      </div>
      {query.error ? <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>{query.error}</Callout> : null}
      {query.saved ? <Callout tone="success">{t(`catalog.saved.${query.saved}`)}</Callout> : null}

      {reorder.length > 0 ? (
        <Callout>
          {t("catalog.inventory.reorderAlert", { count: reorder.length })}{" "}
          <a href="/admin/procurement">{t("catalog.inventory.reorderLink")}</a>
        </Callout>
      ) : null}

      <Card>
        <CardHeader title={t("catalog.inventory.balances")} />
        <CardBody>
          {items.length === 0 ? (
            <p className="mb-4 text-sm text-ink-muted">{t("catalog.inventory.empty")}</p>
          ) : (
            <ul className="mb-4 grid list-none gap-2 p-0">
              {items.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-2 border-b border-rule py-2 text-sm last:border-0">
                  <a href={`/admin/inventory?item=${item.id}`} className="font-medium">
                    {item.productName} · {item.sku}
                  </a>
                  {hideLocation ? null : <span className="text-ink-muted">{item.locationName}</span>}
                  {item.bin ? <span className="font-mono text-xs">{item.bin}</span> : null}
                  <Pill>{t("catalog.inventory.onHandCount", { count: item.onHand })}</Pill>
                  <span className="text-ink-muted">{t("catalog.inventory.reservedCount", { count: item.reserved })}</span>
                  <span className="ms-auto font-medium">{t("catalog.inventory.availableCount", { count: item.available })}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {canManage && variants.length && locations.length ? (
        <Card>
          <CardHeader title={t("catalog.inventory.enableTitle")} />
          <CardBody>
            <p className="mb-4 text-sm text-ink-muted">{t("catalog.inventory.enableIntro")}</p>
            <form action={productAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="intent" value="enableInventory" />
              {hideLocation && onlyLocation ? (
                <input type="hidden" name="locationId" value={onlyLocation.id} />
              ) : null}
              <Field label={t("catalog.inventory.variant")} htmlFor="inv-variant">
                <Select id="inv-variant" name="variantId" required>
                  {variants.map((variant) => (
                    <option key={variant.id} value={variant.id}>
                      {variant.productName} · {variant.sku}
                    </option>
                  ))}
                </Select>
              </Field>
              {hideLocation ? null : (
                <Field label={t("catalog.inventory.location")} htmlFor="inv-location">
                  <Select id="inv-location" name="locationId" required>
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>{location.name}</option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label={t("catalog.inventory.bin")} htmlFor="inv-bin">
                <Input id="inv-bin" name="bin" />
              </Field>
              <div className="self-end"><Button type="submit">{t("catalog.inventory.enable")}</Button></div>
            </form>
          </CardBody>
        </Card>
      ) : null}

      {locations.length === 0 ? (
        <Callout>{t("catalog.inventory.needLocation")}</Callout>
      ) : null}

      {selected && canManage ? (
        <Card>
          <CardHeader title={t("catalog.inventory.itemTitle", { sku: selected.sku })} />
          <CardBody>
            <p className="mb-4 text-sm text-ink-muted">
              {t("catalog.inventory.itemIntro", {
                onHand: selected.onHand,
                reserved: selected.reserved,
                available: selected.available,
              })}
            </p>
            <form action={productAction} className="mb-6 grid gap-3 sm:grid-cols-3">
              <input type="hidden" name="intent" value="setLevels" />
              <input type="hidden" name="itemId" value={selected.id} />
              <Field label={t("catalog.inventory.safety")} htmlFor="lvl-safety">
                <Input id="lvl-safety" name="safetyStock" inputMode="numeric" defaultValue={selected.safetyStock} />
              </Field>
              <Field label={t("catalog.inventory.reorderPoint")} htmlFor="lvl-reorder">
                <Input id="lvl-reorder" name="reorderPoint" inputMode="numeric" defaultValue={selected.reorderPoint} />
              </Field>
              <Field label={t("catalog.inventory.bin")} htmlFor="lvl-bin">
                <Input id="lvl-bin" name="bin" defaultValue={selected.bin ?? ""} />
              </Field>
              <div className="self-end"><Button type="submit">{t("catalog.inventory.saveLevels")}</Button></div>
            </form>
            <form action={productAction} className="mb-6 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="intent" value="setStockPolicy" />
              <input type="hidden" name="variantId" value={selected.variantId} />
              <input type="hidden" name="itemId" value={selected.id} />
              <Field label={t("catalog.inventory.backorder")} htmlFor="bo-policy">
                <Select id="bo-policy" name="backorderPolicy" defaultValue="refuse">
                  {BACKORDER_POLICIES.map((policy) => (
                    <option key={policy} value={policy}>{t(`catalog.inventory.backorderPolicy.${policy}`)}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("catalog.inventory.restockAt")} htmlFor="bo-date">
                <Input id="bo-date" name="expectedRestockAt" type="datetime-local" />
              </Field>
              <div><Button type="submit">{t("catalog.inventory.savePolicy")}</Button></div>
            </form>
            <div className="grid gap-6 lg:grid-cols-2">
              <form action={productAction} className="grid gap-3">
                <input type="hidden" name="intent" value="adjustStock" />
                <input type="hidden" name="itemId" value={selected.id} />
                <Field label={t("catalog.inventory.adjustDelta")} htmlFor="adj-delta">
                  <Input id="adj-delta" name="delta" inputMode="numeric" required />
                </Field>
                <Field label={t("catalog.inventory.adjustNote")} htmlFor="adj-note">
                  <Input id="adj-note" name="note" required minLength={3} />
                </Field>
                <div><Button type="submit">{t("catalog.inventory.adjust")}</Button></div>
              </form>
              <form action={productAction} className="grid gap-3">
                <input type="hidden" name="intent" value="countStock" />
                <input type="hidden" name="itemId" value={selected.id} />
                <Field label={t("catalog.inventory.countQty")} htmlFor="count-qty">
                  <Input id="count-qty" name="quantity" inputMode="numeric" required />
                </Field>
                <Field label={t("catalog.inventory.countNote")} htmlFor="count-note">
                  <Input id="count-note" name="note" />
                </Field>
                <div><Button type="submit">{t("catalog.inventory.count")}</Button></div>
              </form>
              <form action={productAction} className="grid gap-3">
                <input type="hidden" name="intent" value="recordDamage" />
                <input type="hidden" name="itemId" value={selected.id} />
                <Field label={t("catalog.inventory.damageQty")} htmlFor="dmg-qty">
                  <Input id="dmg-qty" name="quantity" inputMode="numeric" required />
                </Field>
                <Field label={t("catalog.inventory.damageNote")} htmlFor="dmg-note">
                  <Input id="dmg-note" name="note" required minLength={3} />
                </Field>
                <div><Button type="submit" variant="danger">{t("catalog.inventory.damage")}</Button></div>
              </form>
              {locations.length > 1 ? (
                <form action={productAction} className="grid gap-3">
                  <input type="hidden" name="intent" value="transferStock" />
                  <input type="hidden" name="fromItemId" value={selected.id} />
                  <Field label={t("catalog.inventory.transferTo")} htmlFor="xfer-to">
                    <Select id="xfer-to" name="toLocationId" required>
                      {locations
                        .filter((location) => location.id !== selected.locationId)
                        .map((location) => (
                          <option key={location.id} value={location.id}>{location.name}</option>
                        ))}
                    </Select>
                  </Field>
                  <Field label={t("catalog.inventory.transferQty")} htmlFor="xfer-qty">
                    <Input id="xfer-qty" name="quantity" inputMode="numeric" required />
                  </Field>
                  <Field label={t("catalog.inventory.transferNote")} htmlFor="xfer-note">
                    <Input id="xfer-note" name="note" />
                  </Field>
                  <div><Button type="submit">{t("catalog.inventory.transfer")}</Button></div>
                </form>
              ) : null}
            </div>
            <h2 className="mt-6 mb-3 text-sm font-semibold">{t("catalog.inventory.ledger")}</h2>
            {movements.length === 0 ? (
              <p className="text-sm text-ink-muted">{t("catalog.inventory.ledgerEmpty")}</p>
            ) : (
              <ol className="grid list-none gap-2 p-0 text-sm">
                {movements.map((row) => (
                  <li key={row.id} className="flex flex-wrap gap-2 border-b border-rule pb-2 last:border-0">
                    <Pill tone={row.delta > 0 ? "success" : "warning"}>
                      {row.delta > 0 ? `+${row.delta}` : String(row.delta)}
                    </Pill>
                    <span>{t(`catalog.inventory.reason.${row.reason}`)}</span>
                    {row.note ? <span className="text-ink-muted">{row.note}</span> : null}
                    <span className="ms-auto font-mono text-xs text-ink-muted">{row.actor}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
