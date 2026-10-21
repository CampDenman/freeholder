// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Automations: what runs by itself, and whether it is switched on
// (C9.01, MASTER.md §4.17).
//
// The list has one job beyond listing: making it obvious which automations are
// actually doing anything. An owner with six rules and no idea which are live
// has a worse problem than an owner with none, so status is a pill on every
// row rather than something to go and check.
import type { Metadata } from "next";
import Link from "next/link";
import { Button, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { listAutomations, triggers } from "@/modules/automations/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import { createAutomationAction } from "../../automation-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const STATUS_TONE = {
  active: "success",
  paused: "warning",
  draft: "neutral",
  archived: "neutral",
} as const;

export default async function AutomationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireStaffActor("automations");
  const query = await searchParams;
  const [t, business, rules, available] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(listAutomations.call({}, actor)),
    domainOrNull(triggers.call({}, actor)),
  ]);

  const locale = business?.defaultLocale ?? "en";
  const when = (value: Date | string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(value),
    );

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("automations.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("automations.intro")}</p>
      </div>

      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("automations.yours")} />
        <CardBody>
          {rules === null ? (
            <p className="text-sm text-danger">{t("automations.unavailable")}</p>
          ) : rules.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("automations.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {rules.map((rule) => (
                <li key={rule.id} className="grid gap-1 rounded-md border border-rule p-3">
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <Link href={`/admin/automations/${rule.id}`} className="font-medium underline">
                      {rule.name}
                    </Link>
                    <Pill tone={STATUS_TONE[rule.status]}>
                      {t(`automations.status.${rule.status}`)}
                    </Pill>
                    <span className="text-ink-muted">
                      {rule.triggerKind === "event"
                        ? t("automations.onEvent", { event: rule.eventPattern ?? "" })
                        : rule.triggerKind === "schedule"
                          ? t("automations.onSchedule", { cron: rule.scheduleCron ?? "" })
                          : t("automations.onManual")}
                    </span>
                    {/* Never published is worth saying outright: an owner
                        reading "draft" may believe a saved canvas is live. */}
                    {rule.currentVersionId === null ? (
                      <Pill tone="warning">{t("automations.neverPublished")}</Pill>
                    ) : null}
                    <span className="ms-auto text-ink-muted">{when(rule.updatedAt)}</span>
                  </div>
                  {rule.description ? (
                    <p className="text-sm text-ink-muted">{rule.description}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("automations.new")} />
        <CardBody>
          <form action={createAutomationAction} className="grid gap-3 md:grid-cols-2">
            <Field label={t("automations.field.name")} htmlFor="name">
              <Input id="name" name="name" required maxLength={120} />
            </Field>
            <Field label={t("automations.field.trigger")} htmlFor="triggerKind">
              <Select id="triggerKind" name="triggerKind" defaultValue="event">
                <option value="event">{t("automations.trigger.event")}</option>
                <option value="schedule">{t("automations.trigger.schedule")}</option>
                <option value="manual">{t("automations.trigger.manual")}</option>
              </Select>
            </Field>
            <Field
              label={t("automations.field.event")}
              htmlFor="eventPattern"
              hint={t("automations.field.eventHint")}
            >
              {/* Chosen, never typed. The list is what modules declare they
                  emit, so it cannot drift from what actually fires. */}
              <Select id="eventPattern" name="eventPattern" defaultValue="">
                <option value="">—</option>
                {(available ?? []).map((event) => (
                  <option key={event.name} value={event.name}>
                    {event.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t("automations.field.schedule")}
              htmlFor="scheduleCron"
              hint={t("automations.field.scheduleHint")}
            >
              <Input id="scheduleCron" name="scheduleCron" placeholder="0 9 * * *" />
            </Field>
            <Field label={t("automations.field.description")} htmlFor="description">
              <Input id="description" name="description" maxLength={2000} />
            </Field>
            <div className="flex items-end">
              <Button type="submit">{t("automations.action.create")}</Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
