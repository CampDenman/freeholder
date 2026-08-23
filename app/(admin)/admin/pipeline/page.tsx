// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The pipeline board (C7.01, MASTER.md §4.1).
//
// A kanban that works without JavaScript: each card carries a small form that
// posts the stage it should move to. Dragging is nicer and comes later; a
// board an owner cannot use on a phone with a bad connection is not a board.
//
// Two views on one screen — deals and lifecycle — because they are the same
// idea at two scales, and §4.1 defines them with the same two tables.
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Pill, type Tone } from "@/ui/primitives";
import { formatMoney } from "@/core/i18n";
import { currentBusiness } from "@/core/settings/read";
import { listContacts } from "@/core/contacts/service";
import { lifecycleBoard, listDeals, listPipelines } from "@/modules/crm/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import {
  createDealAction,
  installDefaultsAction,
  moveContactStageAction,
  moveDealAction,
} from "../../pipeline-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const STATUS_TONES: Record<string, Tone> = {
  open: "accent",
  won: "success",
  lost: "neutral",
};

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; view?: string }>;
}) {
  const actor = await requireStaffActor("crm");
  const query = await searchParams;
  const lifecycleView = query.view === "lifecycle";
  const [t, business, boards, dealsOnBoard, people, lifecycle] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(listPipelines.call({}, actor)),
    domainOrNull(listDeals.call({ status: "open" }, actor)),
    domainOrNull(listContacts.call({ limit: 100 }, actor)),
    domainOrNull(lifecycleBoard.call({}, actor)),
  ]);

  const locale = business?.defaultLocale ?? "en";
  const currency = business?.baseCurrency ?? "GBP";
  const money = (minor: number) => formatMoney(minor, currency, locale);
  const dealBoard = (boards ?? []).find((board) => board.kind === "deal");
  const lifecycleBoardDef = (boards ?? []).find((board) => board.kind === "lifecycle");
  const forecast = (dealsOnBoard ?? []).reduce(
    (total, deal) => total + deal.weightedMinor,
    0,
  );

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("pipeline.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("pipeline.intro")}</p>
        <p className="mt-2 flex flex-wrap gap-4 text-sm">
          <a href="/admin/pipeline" className="underline">
            {t("pipeline.deals")}
          </a>
          <a href="/admin/pipeline?view=lifecycle" className="underline">
            {t("pipeline.lifecycle")}
          </a>
        </p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("pipeline.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error.includes(" ") ? query.error : t("pipeline.failed")}
        </p>
      ) : null}

      {(boards ?? []).length === 0 ? (
        <Card>
          <CardHeader title={t("pipeline.getStarted")} />
          <CardBody>
            {/* §4.1: the module is inert until an owner defines a stage. This
                is the moment they choose to, rather than something boot did. */}
            <p className="max-w-prose text-sm text-ink-muted">{t("pipeline.inertHint")}</p>
            <form action={installDefaultsAction}>
              <Button type="submit">{t("pipeline.action.install")}</Button>
            </form>
          </CardBody>
        </Card>
      ) : lifecycleView ? (
        <Card>
          <CardHeader title={t("pipeline.lifecycle")} />
          <CardBody>
            <div className="grid gap-4 overflow-x-auto md:grid-cols-3 lg:grid-cols-6">
              {(lifecycleBoardDef?.stages ?? []).map((stage) => {
                const here = (lifecycle ?? []).filter((one) => one.stageId === stage.id);
                return (
                  <div key={stage.id} className="grid gap-2">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      {stage.name}
                      <span className="text-ink-muted tabular-nums">{here.length}</span>
                    </h3>
                    <ul className="grid list-none gap-2 p-0">
                      {here.map((entry) => (
                        <li
                          key={entry.contactId}
                          className="grid gap-2 rounded-md border border-rule p-2 text-sm"
                        >
                          <a
                            href={`/admin/contacts/${entry.contactId}`}
                            className="underline"
                          >
                            {entry.contactName}
                          </a>
                          <form
                            action={moveContactStageAction}
                            className="flex items-end gap-1"
                          >
                            <input type="hidden" name="contactId" value={entry.contactId} />
                            <select
                              name="stageId"
                              defaultValue={stage.id}
                              className="w-full rounded-md border border-rule bg-field px-1 py-1 text-xs"
                            >
                              {(lifecycleBoardDef?.stages ?? []).map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.name}
                                </option>
                              ))}
                            </select>
                            <Button type="submit" variant="quiet">
                              {t("pipeline.action.move")}
                            </Button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
            <p className="max-w-prose text-sm text-ink-muted">{t("pipeline.lifecycleHint")}</p>
          </CardBody>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader title={t("pipeline.board")} />
            <CardBody>
              <p className="text-sm text-ink-muted tabular-nums">
                {t("pipeline.forecast", { total: money(forecast) })}
              </p>
              <div className="grid gap-4 overflow-x-auto md:grid-cols-3 lg:grid-cols-5">
                {(dealBoard?.stages ?? []).map((stage) => {
                  const here = (dealsOnBoard ?? []).filter(
                    (deal) => deal.stageId === stage.id,
                  );
                  const worth = here.reduce((total, deal) => total + deal.valueMinor, 0);
                  return (
                    <div key={stage.id} className="grid gap-2">
                      <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                        {stage.name}
                        <span className="text-ink-muted tabular-nums">{money(worth)}</span>
                        {stage.probability !== null ? (
                          <Pill tone="neutral">{stage.probability}%</Pill>
                        ) : null}
                      </h3>
                      <ul className="grid list-none gap-2 p-0">
                        {here.map((deal) => (
                          <li
                            key={deal.id}
                            className="grid gap-2 rounded-md border border-rule p-2 text-sm"
                          >
                            <span className="font-medium">{deal.title}</span>
                            <span className="text-ink-muted">{deal.contactName}</span>
                            <span className="tabular-nums">{money(deal.valueMinor)}</span>
                            <Pill tone={STATUS_TONES[deal.status] ?? "neutral"}>
                              {t(`pipeline.status.${deal.status}`)}
                            </Pill>
                            {/* One form per card, posting the stage to move to.
                                No JavaScript, and the same service the API
                                calls — so a drag and a curl behave alike. */}
                            <form action={moveDealAction} className="grid gap-1">
                              <input type="hidden" name="id" value={deal.id} />
                              <select
                                name="stageId"
                                defaultValue={stage.id}
                                className="w-full rounded-md border border-rule bg-field px-1 py-1 text-xs"
                              >
                                {(dealBoard?.stages ?? []).map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.name}
                                  </option>
                                ))}
                              </select>
                              <input
                                name="lostReason"
                                placeholder={t("pipeline.lostPlaceholder")}
                                className="w-full rounded-md border border-rule bg-field px-1 py-1 text-xs"
                              />
                              <Button type="submit" variant="quiet">
                                {t("pipeline.action.move")}
                              </Button>
                            </form>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("pipeline.open")} />
            <CardBody>
              <form action={createDealAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="currency" value={currency} />
                <label className="grid gap-1 text-sm">
                  <span className="text-ink-muted">{t("pipeline.field.customer")}</span>
                  <select
                    name="contactId"
                    required
                    className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                  >
                    {(people?.rows ?? []).map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid grow gap-1 text-sm">
                  <span className="text-ink-muted">{t("pipeline.field.title")}</span>
                  <input
                    name="title"
                    required
                    className="w-full rounded-md border border-rule bg-field px-2 py-1 text-sm"
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="text-ink-muted">{t("pipeline.field.worth")}</span>
                  <input
                    name="value"
                    inputMode="decimal"
                    className="w-28 rounded-md border border-rule bg-field px-2 py-1 text-sm tabular-nums"
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="text-ink-muted">{t("pipeline.field.closeBy")}</span>
                  <input
                    type="date"
                    name="expectedCloseOn"
                    className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                  />
                </label>
                <Button type="submit">{t("pipeline.action.open")}</Button>
              </form>
              <p className="max-w-prose text-sm text-ink-muted">{t("pipeline.openHint")}</p>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
