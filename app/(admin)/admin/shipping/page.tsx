// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Shipping zones, methods, boxes and windows (C5.18).

import { Boat, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { listLocations } from "@/core/locations/service";
import { currentBusiness } from "@/core/settings/read";
import { hasModuleAccess } from "@/core/service";
import { SHIPPING_METHOD_KINDS } from "@/modules/catalog/contract";
import { listShippingCatalog } from "@/modules/catalog/service";
import { Button, Callout, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { productAction } from "../../catalog-actions";
import { requireStaffActor } from "../guard";

export const dynamic = "force-dynamic";

export default async function ShippingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const actor = await requireStaffActor("catalog");
  const query = await searchParams;
  const [catalog, locations, business, t] = await Promise.all([
    listShippingCatalog.call({}, actor),
    listLocations.call({}, actor),
    currentBusiness(),
    getT(),
  ]);
  const canManage = hasModuleAccess(actor, "catalog", "manage");
  const currency = business?.baseCurrency ?? "CAD";

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <Boat size={22} weight="duotone" className="text-accent" />
          {t("catalog.shipping.title")}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("catalog.shipping.intro")}</p>
      </div>
      {query.error ? <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>{query.error}</Callout> : null}
      {query.saved ? <Callout tone="success">{t(`catalog.saved.${query.saved}`)}</Callout> : null}

      <Card>
        <CardHeader title={t("catalog.shipping.zones")} />
        <CardBody>
          {catalog.zones.length === 0 ? <p className="mb-4 text-sm text-ink-muted">{t("catalog.shipping.zonesEmpty")}</p> : (
            <ul className="mb-4 grid list-none gap-2 p-0 text-sm">
              {catalog.zones.map((zone) => (
                <li key={zone.id}>{zone.name} · {zone.countries.join(", ") || t("catalog.shipping.catchAll")}</li>
              ))}
            </ul>
          )}
          {canManage ? (
            <form action={productAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="intent" value="createZone" />
              <Field label={t("catalog.shipping.zoneName")} htmlFor="zone-name"><Input id="zone-name" name="name" required /></Field>
              <Field label={t("catalog.shipping.countries")} htmlFor="zone-countries"><Input id="zone-countries" name="countries" /></Field>
              <Field label={t("catalog.shipping.regions")} htmlFor="zone-regions"><Input id="zone-regions" name="regions" /></Field>
              <Field label={t("catalog.shipping.postals")} htmlFor="zone-postals"><Input id="zone-postals" name="postalPatterns" /></Field>
              <div><Button type="submit">{t("catalog.shipping.createZone")}</Button></div>
            </form>
          ) : null}
        </CardBody>
      </Card>

      {canManage && catalog.zones.length ? (
        <Card>
          <CardHeader title={t("catalog.shipping.methods")} />
          <CardBody>
            {catalog.methods.map((method) => (
              <p key={method.id} className="mb-2 text-sm">
                <Pill>{method.kind}</Pill> {method.name}
              </p>
            ))}
            <form action={productAction} className="mt-4 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="intent" value="createMethod" />
              <input type="hidden" name="currency" value={currency} />
              <Field label={t("catalog.shipping.zone")} htmlFor="method-zone">
                <Select id="method-zone" name="zoneId" required>
                  {catalog.zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
                </Select>
              </Field>
              <Field label={t("catalog.shipping.methodName")} htmlFor="method-name"><Input id="method-name" name="name" required /></Field>
              <Field label={t("catalog.shipping.kind")} htmlFor="method-kind">
                <Select id="method-kind" name="kind" required>
                  {SHIPPING_METHOD_KINDS.map((kind) => (
                    <option key={kind} value={kind}>{t(`catalog.shipping.kind.${kind}`)}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("catalog.shipping.amount")} htmlFor="method-amount"><Input id="method-amount" name="amount" inputMode="decimal" /></Field>
              <Field label={t("catalog.shipping.threshold")} htmlFor="method-threshold"><Input id="method-threshold" name="threshold" inputMode="decimal" /></Field>
              <Field label={t("catalog.shipping.location")} htmlFor="method-loc">
                <Select id="method-loc" name="locationId">
                  <option value="">{t("catalog.shipping.noLocation")}</option>
                  {locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </Select>
              </Field>
              <div><Button type="submit">{t("catalog.shipping.createMethod")}</Button></div>
            </form>
            {catalog.methods.length ? (
              <form action={productAction} className="mt-4 grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="intent" value="addBand" />
                <input type="hidden" name="currency" value={currency} />
                <Field label={t("catalog.shipping.method")} htmlFor="band-method">
                  <Select id="band-method" name="methodId" required>
                    {catalog.methods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
                  </Select>
                </Field>
                <Field label={t("catalog.shipping.min")} htmlFor="band-min"><Input id="band-min" name="minValue" inputMode="numeric" defaultValue="0" /></Field>
                <Field label={t("catalog.shipping.max")} htmlFor="band-max"><Input id="band-max" name="maxValue" inputMode="numeric" /></Field>
                <Field label={t("catalog.shipping.amount")} htmlFor="band-amount"><Input id="band-amount" name="amount" inputMode="decimal" required /></Field>
                <div><Button type="submit">{t("catalog.shipping.addBand")}</Button></div>
              </form>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {canManage ? (
        <Card>
          <CardHeader title={t("catalog.shipping.boxes")} />
          <CardBody>
            {catalog.boxes.map((box) => (
              <p key={box.id} className="text-sm">{box.name} · {box.innerLengthMm}×{box.innerWidthMm}×{box.innerHeightMm}</p>
            ))}
            <form action={productAction} className="mt-4 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="intent" value="createBox" />
              <Field label={t("catalog.shipping.boxName")} htmlFor="box-name"><Input id="box-name" name="name" required /></Field>
              <Field label={t("catalog.shipping.length")} htmlFor="box-l"><Input id="box-l" name="innerLengthMm" inputMode="numeric" required /></Field>
              <Field label={t("catalog.shipping.width")} htmlFor="box-w"><Input id="box-w" name="innerWidthMm" inputMode="numeric" required /></Field>
              <Field label={t("catalog.shipping.height")} htmlFor="box-h"><Input id="box-h" name="innerHeightMm" inputMode="numeric" required /></Field>
              <Field label={t("catalog.shipping.maxWeight")} htmlFor="box-max"><Input id="box-max" name="maxWeightG" inputMode="numeric" required /></Field>
              <div><Button type="submit">{t("catalog.shipping.createBox")}</Button></div>
            </form>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
