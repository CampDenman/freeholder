// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Referrals: who sent business, what they earned, and paying them
// (C9.09, C9.10, MASTER.md §4.3, §4.13).
//
// The order of the page is the order of the money: what is owed, then who is
// owed it, then the run that pays them, then the paperwork that has to exist
// before it does. An owner arriving here usually wants one of those four and
// should not have to guess which card it is under.
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { formatMoney } from "@/core/i18n";
import { listContacts } from "@/core/contacts/service";
import {
  batches,
  codes,
  commissions,
  payoutLinesFor,
  programs,
  taxPrompts,
} from "@/modules/referrals/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import {
  approveBatchAction,
  buildBatchAction,
  issueCodeAction,
  markBatchPaidAction,
  saveReferralProgramAction,
  saveTaxProfileAction,
} from "../../referral-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const BATCH_TONE = { draft: "neutral", approved: "accent", paid: "success" } as const;

/** The stored commission jsonb, read defensively — it is owner-editable. */
function commissionOf(value: unknown): { kind: string; value: number; capMinor?: number } {
  if (typeof value !== "object" || value === null) return { kind: "none", value: 0 };
  const bag = value as Record<string, unknown>;
  return {
    kind: typeof bag.kind === "string" ? bag.kind : "none",
    value: typeof bag.value === "number" ? bag.value : 0,
    ...(typeof bag.capMinor === "number" ? { capMinor: bag.capMinor } : {}),
  };
}

export default async function ReferralsPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string; batch?: string; saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("referrals", "manage");
  const query = await searchParams;
  const [t, business, all, people, owed, runs, prompts] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(programs.call({}, actor)),
    domainOrNull(listContacts.call({ limit: 200 }, actor)),
    domainOrNull(commissions.call({ limit: 100 }, actor)),
    domainOrNull(batches.call({ limit: 25 }, actor)),
    domainOrNull(
      taxPrompts.call(
        // The calendar year so far, which is the window a threshold is stated
        // in. §4.13 leaves the jurisdiction to the owner; the year is the part
        // every jurisdiction agrees on.
        { since: new Date(new Date().getFullYear(), 0, 1) },
        actor,
      ),
    ),
  ]);

  const chosen = (all ?? []).find((each) => each.id === query.program) ?? (all ?? [])[0] ?? null;
  const issued = chosen
    ? await domainOrNull(codes.call({ programId: chosen.id }, actor))
    : null;
  const openBatch = query.batch ?? (runs ?? [])[0]?.id ?? null;
  const lines = openBatch
    ? await domainOrNull(payoutLinesFor.call({ batchId: openBatch }, actor))
    : null;

  const locale = business?.defaultLocale ?? "en";
  const money = (minor: number, currency: string) => formatMoney(minor, currency, locale);
  const when = (value: Date | string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value));
  const nameOf = new Map((people?.rows ?? []).map((each) => [each.id, each.name]));
  const config = commissionOf(chosen?.commission);

  const pending = (owed ?? []).filter((each) => each.status === "pending");
  const approved = (owed ?? []).filter((each) => each.status === "approved");

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("referrals.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("referrals.intro")}</p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("referrals.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error}
        </p>
      ) : null}

      {/* Held back and payable, separately. §4.13's holdback is the difference
          between "earned" and "owed", and one number covering both would hide
          exactly the thing an owner is deciding about. */}
      <Card>
        <CardHeader title={t("referrals.owed")} />
        <CardBody>
          <div className="flex flex-wrap gap-8">
            <div>
              <p className="text-2xl font-bold tabular-nums">
                {money(
                  approved.reduce((sum, each) => sum + each.amountMinor, 0),
                  approved[0]?.currency ?? business?.baseCurrency ?? "GBP",
                )}
              </p>
              <p className="text-sm text-ink-muted">{t("referrals.payableNow")}</p>
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums text-ink-muted">
                {money(
                  pending.reduce((sum, each) => sum + each.amountMinor, 0),
                  pending[0]?.currency ?? business?.baseCurrency ?? "GBP",
                )}
              </p>
              <p className="text-sm text-ink-muted">{t("referrals.heldBack")}</p>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={chosen ? t("referrals.programme") : t("referrals.newProgramme")} />
        <CardBody>
          <form action={saveReferralProgramAction} className="grid gap-3 md:grid-cols-3">
            {chosen ? <input type="hidden" name="id" value={chosen.id} /> : null}
            <Field label={t("referrals.field.name")} htmlFor="name">
              <Input id="name" name="name" defaultValue={chosen?.name ?? ""} required />
            </Field>
            <Field label={t("referrals.field.status")} htmlFor="status">
              <Select id="status" name="status" defaultValue={chosen?.status ?? "draft"}>
                <option value="draft">{t("referrals.status.draft")}</option>
                <option value="active">{t("referrals.status.active")}</option>
                <option value="closed">{t("referrals.status.closed")}</option>
              </Select>
            </Field>
            <Field
              label={t("referrals.field.model")}
              htmlFor="attributionModel"
              hint={t("referrals.field.modelHint")}
            >
              <Select
                id="attributionModel"
                name="attributionModel"
                defaultValue={chosen?.attributionModel ?? "last_touch"}
              >
                <option value="last_touch">{t("referrals.model.last_touch")}</option>
                <option value="first_touch">{t("referrals.model.first_touch")}</option>
                <option value="position_based">{t("referrals.model.position_based")}</option>
              </Select>
            </Field>
            <Field
              label={t("referrals.field.cookieWindow")}
              htmlFor="cookieWindowDays"
              hint={t("referrals.field.cookieWindowHint")}
            >
              <Input
                id="cookieWindowDays"
                name="cookieWindowDays"
                type="number"
                min={1}
                defaultValue={chosen?.cookieWindowDays ?? 30}
              />
            </Field>
            <Field
              label={t("referrals.field.holdback")}
              htmlFor="holdbackDays"
              hint={t("referrals.field.holdbackHint")}
            >
              <Input
                id="holdbackDays"
                name="holdbackDays"
                type="number"
                min={0}
                defaultValue={chosen?.holdbackDays ?? 30}
              />
            </Field>
            <Field
              label={t("referrals.field.commissionKind")}
              htmlFor="commissionKind"
              hint={t("referrals.field.commissionKindHint")}
            >
              <Select id="commissionKind" name="commissionKind" defaultValue={config.kind}>
                <option value="none">{t("referrals.commission.none")}</option>
                <option value="percent">{t("referrals.commission.percent")}</option>
                <option value="fixed">{t("referrals.commission.fixed")}</option>
              </Select>
            </Field>
            <Field label={t("referrals.field.commissionValue")} htmlFor="commissionValue">
              <Input
                id="commissionValue"
                name="commissionValue"
                type="number"
                min={0}
                defaultValue={
                  config.kind === "percent" ? Math.round(config.value / 10_000) : config.value
                }
              />
            </Field>
            <Field label={t("referrals.field.commissionCap")} htmlFor="commissionCap">
              <Input
                id="commissionCap"
                name="commissionCap"
                type="number"
                min={0}
                defaultValue={config.capMinor ?? ""}
              />
            </Field>
            <div className="flex items-end">
              <Button type="submit">{t("referrals.action.saveProgramme")}</Button>
            </div>
          </form>
        </CardBody>
      </Card>

      {chosen ? (
        <Card>
          <CardHeader title={t("referrals.codes")} />
          <CardBody>
            {issued === null || issued.length === 0 ? (
              <p className="max-w-prose text-sm text-ink-muted">{t("referrals.noCodes")}</p>
            ) : (
              <ul className="grid list-none gap-2 p-0">
                {issued.map((code) => (
                  <li
                    key={code.id}
                    className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                  >
                    <code className="font-mono font-medium">{code.code}</code>
                    <span>{nameOf.get(code.contactId) ?? code.contactId}</span>
                    <span className="text-ink-muted tabular-nums">
                      {t("referrals.clicks", { n: String(code.clicks) })}
                    </span>
                    <Pill tone={code.status === "active" ? "success" : "neutral"}>
                      {t(`referrals.codeStatus.${code.status}`)}
                    </Pill>
                  </li>
                ))}
              </ul>
            )}

            <form action={issueCodeAction} className="mt-3 grid gap-3 md:grid-cols-4">
              <input type="hidden" name="programId" value={chosen.id} />
              <Field label={t("referrals.field.referrer")} htmlFor="contactId">
                <Select id="contactId" name="contactId" required defaultValue="">
                  <option value="">—</option>
                  {(people?.rows ?? []).map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={t("referrals.field.code")}
                htmlFor="code"
                hint={t("referrals.field.codeHint")}
              >
                <Input id="code" name="code" required maxLength={32} />
              </Field>
              <Field label={t("referrals.field.landingPath")} htmlFor="landingPath">
                <Input id="landingPath" name="landingPath" placeholder="/" />
              </Field>
              <div className="flex items-end">
                <Button type="submit">{t("referrals.action.issueCode")}</Button>
              </div>
            </form>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t("referrals.payouts")} />
        <CardBody>
          {runs === null || runs.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("referrals.noBatches")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {runs.map((batch) => (
                <li key={batch.id} className="grid gap-2 rounded-md border border-rule p-3">
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="font-medium tabular-nums">
                      {money(batch.totalMinor, batch.currency)}
                    </span>
                    <Pill tone={BATCH_TONE[batch.status]}>
                      {t(`referrals.batchStatus.${batch.status}`)}
                    </Pill>
                    <span className="text-ink-muted">
                      {when(batch.periodStart)} – {when(batch.periodEnd)}
                    </span>

                    {/* A file, because §4.13 says the owner hands it to their
                        bank or accountant. */}
                    <a
                      href={`/admin/referrals/payouts/${batch.id}/csv`}
                      className="ms-auto text-sm underline"
                    >
                      {t("referrals.action.csv")}
                    </a>
                    {batch.status === "draft" ? (
                      <form action={approveBatchAction}>
                        <input type="hidden" name="batchId" value={batch.id} />
                        <Button type="submit" variant="quiet">
                          {t("referrals.action.approve")}
                        </Button>
                      </form>
                    ) : null}
                    {batch.status === "approved" ? (
                      <form action={markBatchPaidAction}>
                        <input type="hidden" name="batchId" value={batch.id} />
                        <Button type="submit" variant="quiet">
                          {t("referrals.action.markPaid")}
                        </Button>
                      </form>
                    ) : null}
                    <form method="get">
                      <input type="hidden" name="batch" value={batch.id} />
                      <Button type="submit" variant="quiet">
                        {t("referrals.action.showLines")}
                      </Button>
                    </form>
                  </div>

                  {/* Who is on it, before approving it. Approving a payment run
                      you can only read as a total is a guess, not a decision. */}
                  {openBatch === batch.id && lines ? (
                    <ul className="grid list-none gap-1 p-0 ps-3">
                      {lines.map((line) => (
                        <li key={line.id} className="flex flex-wrap items-center gap-3 text-sm">
                          <span>
                            {nameOf.get(line.affiliateContactId) ?? line.affiliateContactId}
                          </span>
                          <span className="tabular-nums">
                            {money(line.amountMinor, line.currency)}
                          </span>
                          <Pill
                            tone={line.taxFormState === "collected" ? "success" : "warning"}
                          >
                            {t(`referrals.tax.${line.taxFormState}`)}
                          </Pill>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <form action={buildBatchAction} className="mt-3 grid gap-3 md:grid-cols-4">
            <Field label={t("referrals.field.periodStart")} htmlFor="periodStart">
              <Input id="periodStart" name="periodStart" type="date" required />
            </Field>
            <Field label={t("referrals.field.periodEnd")} htmlFor="periodEnd">
              <Input id="periodEnd" name="periodEnd" type="date" required />
            </Field>
            <Field label={t("referrals.field.currency")} htmlFor="currency">
              <Input
                id="currency"
                name="currency"
                defaultValue={business?.baseCurrency ?? "GBP"}
                maxLength={3}
              />
            </Field>
            <div className="flex items-end">
              <Button type="submit">{t("referrals.action.buildBatch")}</Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("referrals.tax")} />
        <CardBody>
          <p className="max-w-prose text-sm text-ink-muted">{t("referrals.taxIntro")}</p>
          {prompts === null || prompts.length === 0 ? (
            <p className="mt-2 max-w-prose text-sm text-ink-muted">{t("referrals.noPrompts")}</p>
          ) : (
            <ul className="mt-2 grid list-none gap-2 p-0">
              {prompts.map((prompt) => (
                <li
                  key={prompt.contactId}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-warning p-3 text-sm"
                >
                  <span className="font-medium">
                    {nameOf.get(prompt.contactId) ?? prompt.contactId}
                  </span>
                  <span className="tabular-nums">
                    {money(prompt.paidMinor, prompt.currency)}
                  </span>
                  <Pill tone="warning">{t(`referrals.tax.${prompt.state}`)}</Pill>
                </li>
              ))}
            </ul>
          )}

          <form action={saveTaxProfileAction} className="mt-3 grid gap-3 md:grid-cols-4">
            <Field label={t("referrals.field.affiliate")} htmlFor="taxContact">
              <Select id="taxContact" name="contactId" required defaultValue="">
                <option value="">—</option>
                {(people?.rows ?? []).map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("referrals.field.jurisdiction")} htmlFor="jurisdiction">
              <Input id="jurisdiction" name="jurisdiction" maxLength={120} />
            </Field>
            <Field
              label={t("referrals.field.formKind")}
              htmlFor="formKind"
              hint={t("referrals.field.formKindHint")}
            >
              <Input id="formKind" name="formKind" maxLength={60} />
            </Field>
            <Field label={t("referrals.field.taxState")} htmlFor="state">
              <Select id="state" name="state" defaultValue="requested">
                <option value="not_required">{t("referrals.tax.not_required")}</option>
                <option value="requested">{t("referrals.tax.requested")}</option>
                <option value="collected">{t("referrals.tax.collected")}</option>
                <option value="expired">{t("referrals.tax.expired")}</option>
              </Select>
            </Field>
            <Field
              label={t("referrals.field.threshold")}
              htmlFor="thresholdMinor"
              hint={t("referrals.field.thresholdHint")}
            >
              <Input id="thresholdMinor" name="thresholdMinor" type="number" min={0} />
            </Field>
            <Field label={t("referrals.field.note")} htmlFor="note">
              <Input id="note" name="note" maxLength={2000} />
            </Field>
            <div className="flex items-end">
              <Button type="submit">{t("referrals.action.saveTax")}</Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
