// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Memberships (MASTER.md §4.15, §43 C9.13).
//
// Two lists and a form. The plan form has no price field, deliberately: a
// plan is "a subscription product's shape" and the money is the product's, so
// an owner changing what a membership costs does it in one place and every
// subscriber's next invoice follows. A price box here would be a second
// answer, and the two would disagree within a month.
import type { Metadata } from "next";
import { ArrowsClockwise } from "@phosphor-icons/react/dist/ssr";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Pill,
  Select,
} from "@/ui/primitives";
import { listContacts } from "@/core/contacts/service";
import { currentBusiness } from "@/core/settings/read";
import { listProducts } from "@/modules/catalog/service";
import { listPlans, listSubscriptions } from "@/modules/subscriptions/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import {
  cancelSubscriptionAction,
  pauseSubscriptionAction,
  resumeSubscriptionAction,
  savePlanAction,
  subscribeAction,
} from "../../subscription-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const INTERVALS = ["day", "week", "month", "year"] as const;

/** Which states are worth an owner's eye, and which are simply history. */
const TONE = {
  trialing: "accent",
  active: "success",
  past_due: "danger",
  paused: "warning",
  cancelled: "neutral",
  expired: "neutral",
} as const;

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; error?: string; saved?: string; enrolled?: string }>;
}) {
  const actor = await requireStaffActor("subscriptions", "manage");
  const query = await searchParams;

  const [t, business, plans, people, products, contacts] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(listPlans.call({}, actor)),
    domainOrNull(listSubscriptions.call({ limit: 100 }, actor)),
    domainOrNull(listProducts.call({ status: "active" }, actor)),
    listContacts.call({ limit: 100 }, actor).catch(() => ({ rows: [], total: 0 })),
  ]);

  const chosen = query.plan ? (plans ?? []).find((each) => each.id === query.plan) : null;
  const locale = business?.defaultLocale ?? "en";
  const timezone = business?.timezone ?? "UTC";
  const when = (value: Date | string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: timezone }).format(
      new Date(value),
    );
  const planName = new Map((plans ?? []).map((each) => [each.id, each.name]));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <ArrowsClockwise size={22} weight="duotone" className="text-accent" />
          {t("subscriptions.title")}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("subscriptions.intro")}</p>
      </div>

      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error}
        </p>
      ) : null}
      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("subscriptions.saved")}
        </p>
      ) : null}
      {query.enrolled ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("subscriptions.enrolled")}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("subscriptions.plans")} />
        <CardBody>
          {(plans ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">{t("subscriptions.noPlans")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {(plans ?? []).map((plan) => (
                <li
                  key={plan.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                >
                  <form method="get">
                    <input type="hidden" name="plan" value={plan.id} />
                    <Button type="submit" variant="quiet">
                      {plan.name}
                    </Button>
                  </form>
                  <span className="text-ink-muted">
                    {t("subscriptions.field.interval")}{" "}
                    {plan.intervalCount > 1 ? `${plan.intervalCount} ` : ""}
                    {t(`subscriptions.interval.${plan.interval}`).toLocaleLowerCase(locale)}
                  </span>
                  {plan.trialDays > 0 ? (
                    <Pill tone="accent">
                      {t("subscriptions.field.trialDays")}: {plan.trialDays}
                    </Pill>
                  ) : null}
                  <Pill tone={plan.status === "active" ? "success" : "neutral"}>
                    {t(`subscriptions.planStatus.${plan.status}`)}
                  </Pill>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={chosen ? chosen.name : t("subscriptions.newPlan")} />
        <CardBody>
          {/* Said once, where the decision is made: this is what "manual"
              means, rather than something an owner discovers when the first
              renewal does not charge a card. */}
          <p className="mb-3 max-w-prose text-sm text-ink-muted">
            {t("subscriptions.manualOnly")}
          </p>
          <form action={savePlanAction} className="grid gap-3 md:grid-cols-3">
            {chosen ? <input type="hidden" name="id" value={chosen.id} /> : null}
            <Field label={t("subscriptions.field.product")} htmlFor="productId">
              <Select id="productId" name="productId" defaultValue={chosen?.productId ?? ""} required>
                {(products ?? []).map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("subscriptions.field.name")} htmlFor="name">
              <Input id="name" name="name" defaultValue={chosen?.name ?? ""} required maxLength={200} />
            </Field>
            <Field label={t("subscriptions.field.status")} htmlFor="status">
              <Select id="status" name="status" defaultValue={chosen?.status ?? "draft"}>
                <option value="draft">{t("subscriptions.planStatus.draft")}</option>
                <option value="active">{t("subscriptions.planStatus.active")}</option>
                <option value="archived">{t("subscriptions.planStatus.archived")}</option>
              </Select>
            </Field>
            <Field label={t("subscriptions.field.interval")} htmlFor="interval">
              <Select id="interval" name="interval" defaultValue={chosen?.interval ?? "month"}>
                {INTERVALS.map((interval) => (
                  <option key={interval} value={interval}>
                    {t(`subscriptions.interval.${interval}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("subscriptions.field.intervalCount")} htmlFor="intervalCount">
              <Input
                id="intervalCount"
                name="intervalCount"
                type="number"
                min={1}
                max={52}
                defaultValue={chosen?.intervalCount ?? 1}
              />
            </Field>
            <Field
              label={t("subscriptions.field.trialDays")}
              htmlFor="trialDays"
              hint={t("subscriptions.field.trialHint")}
            >
              <Input
                id="trialDays"
                name="trialDays"
                type="number"
                min={0}
                max={365}
                defaultValue={chosen?.trialDays ?? 0}
              />
            </Field>
            <Field
              label={t("subscriptions.field.setupFee")}
              htmlFor="setupFeeMinor"
              hint={t("subscriptions.field.setupFeeHint")}
            >
              <Input
                id="setupFeeMinor"
                name="setupFeeMinor"
                type="number"
                min={0}
                defaultValue={chosen?.setupFeeMinor ?? 0}
              />
            </Field>
            <Field label={t("subscriptions.field.cancelBehaviour")} htmlFor="cancelBehaviour">
              <Select
                id="cancelBehaviour"
                name="cancelBehaviour"
                defaultValue={chosen?.cancelBehaviour ?? "period_end"}
              >
                <option value="period_end">{t("subscriptions.cancel.period_end")}</option>
                <option value="immediate">{t("subscriptions.cancel.immediate")}</option>
              </Select>
            </Field>
            <div className="self-end">
              <Button type="submit">{t("subscriptions.action.savePlan")}</Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("subscriptions.enroll.title")} />
        <CardBody>
          <p className="mb-3 max-w-prose text-sm text-ink-muted">
            {t("subscriptions.enroll.intro")}
          </p>
          {contacts.rows.length === 0 || (plans ?? []).filter((each) => each.status === "active").length === 0 ? (
            <p className="text-sm text-ink-muted">{t("subscriptions.enroll.missing")}</p>
          ) : (
            <form action={subscribeAction} className="grid gap-3 md:grid-cols-3">
              <Field label={t("subscriptions.enroll.contact")} htmlFor="contactId">
                <Select id="contactId" name="contactId" required defaultValue="">
                  <option value="">{t("subscriptions.enroll.chooseContact")}</option>
                  {contacts.rows.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name}
                      {contact.email ? ` · ${contact.email}` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("subscriptions.enroll.plan")} htmlFor="planId">
                <Select id="planId" name="planId" required defaultValue="">
                  <option value="">{t("subscriptions.enroll.choosePlan")}</option>
                  {(plans ?? [])
                    .filter((each) => each.status === "active")
                    .map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name}
                      </option>
                    ))}
                </Select>
              </Field>
              <div className="self-end">
                <Button type="submit">{t("subscriptions.enroll.submit")}</Button>
              </div>
            </form>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("subscriptions.people")} />
        <CardBody>
          {(people ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">{t("subscriptions.noPeople")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {(people ?? []).map((subscription) => (
                <li
                  key={subscription.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                >
                  <span className="font-semibold text-ink">
                    {planName.get(subscription.planId) ?? subscription.planId}
                  </span>
                  <Pill tone={TONE[subscription.status]}>
                    {t(`subscriptions.status.${subscription.status}`)}
                  </Pill>
                  <span className="text-ink-muted">
                    {t(
                      subscription.cancelAtPeriodEnd
                        ? "subscriptions.endsAt"
                        : "subscriptions.renewsAt",
                      { date: when(subscription.currentPeriodEnd) },
                    )}
                  </span>
                  {/* Cancelled-but-running says so plainly. It is the state an
                      owner is most likely to misread as still selling. */}
                  {subscription.cancelAtPeriodEnd && subscription.status !== "expired" ? (
                    <Pill tone="warning">{t("subscriptions.leaving")}</Pill>
                  ) : null}

                  <span className="ms-auto flex flex-wrap gap-2">
                    {subscription.status === "active" || subscription.status === "trialing" ? (
                      <form action={pauseSubscriptionAction}>
                        <input type="hidden" name="id" value={subscription.id} />
                        <Button type="submit" variant="quiet">
                          {t("subscriptions.action.pause")}
                        </Button>
                      </form>
                    ) : null}
                    {subscription.status === "paused" ? (
                      <form action={resumeSubscriptionAction}>
                        <input type="hidden" name="id" value={subscription.id} />
                        <Button type="submit" variant="quiet">
                          {t("subscriptions.action.resume")}
                        </Button>
                      </form>
                    ) : null}
                    {subscription.status !== "cancelled" && subscription.status !== "expired" ? (
                      <form action={cancelSubscriptionAction}>
                        <input type="hidden" name="id" value={subscription.id} />
                        <Button type="submit" variant="quiet">
                          {t("subscriptions.action.cancel")}
                        </Button>
                      </form>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
