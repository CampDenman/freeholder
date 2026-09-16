// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Which content is gated, and how (MASTER.md §4.15, C9.15).
import type { Metadata } from "next";
import { Lock } from "@phosphor-icons/react/dist/ssr";
import { Button, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { listPaywalls } from "@/core/paywalls/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import { savePaywallAction } from "../../paywall-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PaywallsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; paywall?: string }>;
}) {
  const actor = await requireStaffActor("paywalls", "manage");
  const query = await searchParams;
  const [t, walls] = await Promise.all([
    getT(),
    domainOrNull(listPaywalls.call({ limit: 100 }, actor)),
  ]);
  const chosen = query.paywall ? (walls ?? []).find((row) => row.id === query.paywall) : null;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <Lock size={22} weight="duotone" className="text-accent" />
          {t("paywalls.title")}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("paywalls.intro")}</p>
      </div>

      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error}
        </p>
      ) : null}
      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("paywalls.saved")}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("paywalls.list")} />
        <CardBody>
          {(walls ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">{t("paywalls.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {(walls ?? []).map((wall) => (
                <li
                  key={wall.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                >
                  <form method="get">
                    <input type="hidden" name="paywall" value={wall.id} />
                    <Button type="submit" variant="quiet">
                      {wall.name}
                    </Button>
                  </form>
                  <span className="text-ink-muted">
                    {t(`paywalls.mode.${wall.mode}`)} · {wall.appliesTo.kind}/{wall.appliesTo.selector}
                  </span>
                  <Pill tone={wall.status === "active" ? "success" : "neutral"}>
                    {t(`paywalls.status.${wall.status}`)}
                  </Pill>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={chosen ? chosen.name : t("paywalls.new")} />
        <CardBody>
          <form action={savePaywallAction} className="grid gap-3 md:grid-cols-3">
            {chosen ? <input type="hidden" name="id" value={chosen.id} /> : null}
            <Field label={t("paywalls.field.name")} htmlFor="name">
              <Input id="name" name="name" required maxLength={200} defaultValue={chosen?.name ?? ""} />
            </Field>
            <Field label={t("paywalls.field.kind")} htmlFor="kind">
              <Select id="kind" name="kind" defaultValue={chosen?.appliesTo.kind ?? "page"}>
                <option value="page">{t("paywalls.kind.page")}</option>
                <option value="post">{t("paywalls.kind.post")}</option>
                <option value="gallery">{t("paywalls.kind.gallery")}</option>
                <option value="collection">{t("paywalls.kind.collection")}</option>
                <option value="tag">{t("paywalls.kind.tag")}</option>
                <option value="product">{t("paywalls.kind.product")}</option>
              </Select>
            </Field>
            <Field
              label={t("paywalls.field.selector")}
              htmlFor="selector"
              hint={t("paywalls.field.selectorHint")}
            >
              <Input
                id="selector"
                name="selector"
                required
                defaultValue={chosen?.appliesTo.selector ?? "*"}
              />
            </Field>
            <Field label={t("paywalls.field.mode")} htmlFor="mode">
              <Select id="mode" name="mode" defaultValue={chosen?.mode ?? "hard"}>
                <option value="hard">{t("paywalls.mode.hard")}</option>
                <option value="soft">{t("paywalls.mode.soft")}</option>
                <option value="metered">{t("paywalls.mode.metered")}</option>
                <option value="registration">{t("paywalls.mode.registration")}</option>
              </Select>
            </Field>
            <Field label={t("paywalls.field.seoPolicy")} htmlFor="seoPolicy">
              <Select id="seoPolicy" name="seoPolicy" defaultValue={chosen?.seoPolicy ?? "fully_gated"}>
                <option value="fully_gated">{t("paywalls.seo.fully_gated")}</option>
                <option value="flexible_sampling">{t("paywalls.seo.flexible_sampling")}</option>
              </Select>
            </Field>
            <Field label={t("paywalls.field.status")} htmlFor="status">
              <Select id="status" name="status" defaultValue={chosen?.status ?? "active"}>
                <option value="active">{t("paywalls.status.active")}</option>
                <option value="archived">{t("paywalls.status.archived")}</option>
              </Select>
            </Field>
            <Field label={t("paywalls.field.previewStrategy")} htmlFor="previewStrategy">
              <Select
                id="previewStrategy"
                name="previewStrategy"
                defaultValue={chosen?.previewStrategy ?? "blocks"}
              >
                <option value="blocks">{t("paywalls.preview.blocks")}</option>
                <option value="paragraphs">{t("paywalls.preview.paragraphs")}</option>
                <option value="percent">{t("paywalls.preview.percent")}</option>
              </Select>
            </Field>
            <Field label={t("paywalls.field.previewValue")} htmlFor="previewValue">
              <Input
                id="previewValue"
                name="previewValue"
                type="number"
                min={0}
                defaultValue={chosen?.previewValue ?? 1}
              />
            </Field>
            <Field label={t("paywalls.field.meterCount")} htmlFor="meterCount">
              <Input
                id="meterCount"
                name="meterCount"
                type="number"
                min={0}
                defaultValue={chosen?.meterCount ?? 0}
              />
            </Field>
            <Field label={t("paywalls.field.meterWindowDays")} htmlFor="meterWindowDays">
              <Input
                id="meterWindowDays"
                name="meterWindowDays"
                type="number"
                min={1}
                defaultValue={chosen?.meterWindowDays ?? 30}
              />
            </Field>
            <Field
              label={t("paywalls.field.requiredEntitlements")}
              htmlFor="requiredEntitlementIds"
              hint={t("paywalls.field.requiredHint")}
            >
              <Input
                id="requiredEntitlementIds"
                name="requiredEntitlementIds"
                defaultValue={(chosen?.requiredEntitlementIds ?? []).join(" ")}
              />
            </Field>
            <Field
              label={t("paywalls.field.upsellPageId")}
              htmlFor="upsellPageId"
              hint={t("paywalls.field.upsellHint")}
            >
              <Input
                id="upsellPageId"
                name="upsellPageId"
                defaultValue={chosen?.upsellPageId ?? ""}
              />
            </Field>
            <div className="self-end">
              <Button type="submit">{t("paywalls.action.save")}</Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
