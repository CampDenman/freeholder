// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Segments: the one definition of "who" (C7.04, MASTER.md §4.14).
//
// The screen has one job beyond saving a query: making the answer legible
// before anybody acts on it. So a saved segment shows its count *and* the date
// that count was taken, and asking "why is this person in it" runs the rules
// rather than describing them.
//
// The rule builder is three rows of plain selects and one text box. That is
// enough for §4.14's own example — "customers in Ontario who bought twice" is
// two rules — and it works with no JavaScript, which a drag-and-drop query
// builder does not.
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import {
  explainMembership,
  listSegmentFields,
  listSegments,
} from "@/core/segments/service";
import { listContacts } from "@/core/contacts/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import {
  captureSegmentAction,
  removeSegmentAction,
  saveSegmentAction,
} from "../../segment-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function SegmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; why?: string; who?: string }>;
}) {
  const actor = await requireStaffActor("crm");
  const query = await searchParams;
  const [t, business, saved, fields, people] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(listSegments.call({}, actor)),
    domainOrNull(listSegmentFields.call({}, actor)),
    domainOrNull(listContacts.call({ limit: 100 }, actor)),
  ]);

  const locale = business?.defaultLocale ?? "en";
  const when = (value: Date | string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(value),
    );

  // The explanation is a query, so it only runs when somebody asked for one.
  const explanation =
    query.why && query.who
      ? await domainOrNull(
          explainMembership.call({ id: query.why, contactId: query.who }, actor),
        )
      : null;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("segments.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("segments.intro")}</p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("segments.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error.includes(" ") ? query.error : t("segments.failed")}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("segments.yours")} />
        <CardBody>
          {saved === null ? (
            <p className="text-sm text-danger">{t("segments.unavailable")}</p>
          ) : saved.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("segments.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {saved.map((segment) => (
                <li key={segment.id} className="grid gap-2 rounded-md border border-rule p-3">
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="font-medium">{segment.name}</span>
                    <Pill tone={segment.kind === "static" ? "neutral" : "accent"}>
                      {t(`segments.kind.${segment.kind}`)}
                    </Pill>
                    {/* A number and the moment it was taken, never one without
                        the other: a stale count nobody can date is a count
                        people start trusting. */}
                    <span className="tabular-nums">
                      {t("segments.count", { count: String(segment.memberCountCached ?? 0) })}
                    </span>
                    {segment.lastEvaluatedAt ? (
                      <span className="text-ink-muted">
                        {t("segments.asOf", { when: when(segment.lastEvaluatedAt) })}
                      </span>
                    ) : null}
                    {segment.kind === "dynamic" ? (
                      <form action={captureSegmentAction} className="ms-auto">
                        <input type="hidden" name="id" value={segment.id} />
                        <Button type="submit" variant="quiet">
                          {t("segments.action.capture")}
                        </Button>
                      </form>
                    ) : null}
                    <form action={removeSegmentAction}>
                      <input type="hidden" name="id" value={segment.id} />
                      <Button type="submit" variant="quiet">
                        {t("segments.action.remove")}
                      </Button>
                    </form>
                  </div>
                  {segment.description ? (
                    <p className="text-sm text-ink-muted">{segment.description}</p>
                  ) : null}
                  {/* Why is this person in it? A GET, so the answer is a link
                      somebody can send to a colleague. */}
                  <form method="get" className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="why" value={segment.id} />
                    <label className="grid gap-1 text-sm">
                      <span className="text-ink-muted">{t("segments.why")}</span>
                      <select
                        name="who"
                        className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                      >
                        {(people?.rows ?? []).map((contact) => (
                          <option key={contact.id} value={contact.id}>
                            {contact.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button type="submit" variant="quiet">
                      {t("segments.action.why")}
                    </Button>
                  </form>
                  {explanation && query.why === segment.id ? (
                    <div className="rounded-md border border-rule p-3 text-sm">
                      <p className="font-medium">
                        {explanation.member ? t("segments.isMember") : t("segments.isNotMember")}
                      </p>
                      <ul className="mt-2 grid list-none gap-1 p-0">
                        {explanation.reasons.map((reason) => (
                          <li key={reason.field} className="flex flex-wrap items-center gap-2">
                            <Pill tone={reason.passed ? "success" : "neutral"}>
                              {reason.passed ? t("segments.passed") : t("segments.failedRule")}
                            </Pill>
                            <span>{reason.label}</span>
                            <span className="text-ink-muted">
                              {t(`segments.op.${reason.op}`)} {reason.value}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("segments.add")} />
        <CardBody>
          <form action={saveSegmentAction} className="grid gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="grid grow gap-1 text-sm">
                <span className="text-ink-muted">{t("segments.field.name")}</span>
                <input
                  name="name"
                  required
                  className="w-full rounded-md border border-rule bg-field px-2 py-1 text-sm"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-ink-muted">{t("segments.field.match")}</span>
                <select
                  name="match"
                  defaultValue="all"
                  className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                >
                  <option value="all">{t("segments.match.all")}</option>
                  <option value="any">{t("segments.match.any")}</option>
                </select>
              </label>
            </div>
            {[0, 1, 2].map((index) => (
              <div key={index} className="flex flex-wrap items-end gap-2">
                <label className="grid gap-1 text-sm">
                  <span className="sr-only">{t("segments.field.rule")}</span>
                  <select
                    name="field"
                    defaultValue=""
                    className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                  >
                    <option value="">{t("segments.field.none")}</option>
                    {(fields ?? []).map((field) => (
                      <option key={field.key} value={field.key}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="sr-only">{t("segments.field.op")}</span>
                  <select
                    name="op"
                    defaultValue="is"
                    className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                  >
                    {["is", "isNot", "isOneOf", "contains", "atLeast", "atMost", "inLastDays", "before", "after", "isSet", "isNotSet"].map(
                      (op) => (
                        <option key={op} value={op}>
                          {t(`segments.op.${op}`)}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label className="grid grow gap-1 text-sm">
                  <span className="sr-only">{t("segments.field.value")}</span>
                  <input
                    name="value"
                    className="w-full rounded-md border border-rule bg-field px-2 py-1 text-sm"
                  />
                </label>
              </div>
            ))}
            <Button type="submit">{t("segments.action.save")}</Button>
          </form>
          {/* Commas mean a list, because "one of" is the operator people reach
              for and asking them to write JSON is not an option. */}
          <p className="max-w-prose text-sm text-ink-muted">{t("segments.hint")}</p>
        </CardBody>
      </Card>
    </div>
  );
}
