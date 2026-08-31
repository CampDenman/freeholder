// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Ads: the positions you sell, who buys them, and what runs
// (C9.17, MASTER.md §4.16).
//
// Inventory first, buyers second, campaigns third — the order a publisher
// actually works in. You cannot sell a slot that does not exist, and §4.16's
// point about reserved space is a property of the slot rather than of the sale.
//
// Nothing here serves an ad. C9.17 shipped inventory that deliberately renders
// nothing: creatives, house fill and the counting are C9.18–C9.20. The screen
// says so rather than leaving an owner to wonder why their live campaign shows
// no impressions.
import type { Metadata } from "next";
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Pill,
  Select,
} from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { formatMoney } from "@/core/i18n";
import { listContacts } from "@/core/contacts/service";
import {
  advertiserList,
  campaigns,
  lineItems,
  sizes,
  slots,
} from "@/modules/ads/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import {
  decideCampaignAction,
  saveAdvertiserAction,
  saveCampaignAction,
  saveLineItemAction,
  saveSlotAction,
  setCampaignStatusAction,
} from "../../ads-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const CAMPAIGN_TONE = {
  draft: "neutral",
  scheduled: "accent",
  live: "success",
  paused: "warning",
  completed: "neutral",
} as const;

/** The stored formats jsonb, read defensively — it is owner-editable. */
function formatsOf(value: unknown): Array<{ breakpoint: string; sizes: Array<{ width: number; height: number }> }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const bag = entry as Record<string, unknown>;
    if (typeof bag.breakpoint !== "string" || !Array.isArray(bag.sizes)) return [];
    return [
      {
        breakpoint: bag.breakpoint,
        sizes: bag.sizes.filter(
          (size): size is { width: number; height: number } =>
            typeof size === "object" &&
            size !== null &&
            typeof (size as { width?: unknown }).width === "number" &&
            typeof (size as { height?: unknown }).height === "number",
        ),
      },
    ];
  });
}

export default async function AdsPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string; saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("ads", "manage");
  const query = await searchParams;
  const [t, business, positions, sizeList, buyers, sold, people] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(slots.call({}, actor)),
    domainOrNull(sizes.call({}, actor)),
    domainOrNull(advertiserList.call({}, actor)),
    domainOrNull(campaigns.call({}, actor)),
    domainOrNull(listContacts.call({ limit: 200 }, actor)),
  ]);

  const openCampaign = query.campaign ?? (sold ?? [])[0]?.id ?? null;
  const items = openCampaign
    ? await domainOrNull(lineItems.call({ campaignId: openCampaign }, actor))
    : null;

  const locale = business?.defaultLocale ?? "en";
  const currency = business?.baseCurrency ?? "GBP";
  const money = (minor: number) => formatMoney(minor, currency, locale);
  const when = (value: Date | string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value));
  const nameOf = new Map((people?.rows ?? []).map((each) => [each.id, each.name]));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("ads.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("ads.intro")}</p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("ads.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error}
        </p>
      ) : null}

      {/* Said once, plainly. A live campaign showing nothing is otherwise read
          as a bug rather than as the next piece of work. */}
      <Callout tone="neutral">{t("ads.notServingYet")}</Callout>

      <Card>
        <CardHeader title={t("ads.slots")} />
        <CardBody>
          {positions === null || positions.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("ads.noSlots")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {positions.map((slot) => (
                <li key={slot.id} className="grid gap-1 rounded-md border border-rule p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-medium">{slot.name}</span>
                    <code className="font-mono text-xs">{slot.code}</code>
                    <Pill tone={slot.status === "active" ? "success" : "neutral"}>
                      {t(`ads.slotStatus.${slot.status}`)}
                    </Pill>
                    {slot.allowThirdParty ? (
                      <Pill tone="warning">{t("ads.thirdPartyOn")}</Pill>
                    ) : null}
                  </div>
                  {/* The reserved shape per breakpoint. §4.16 wants the hole
                      reserved because an ad that arrives late and pushes the
                      article down is a Core Web Vitals failure. */}
                  <div className="flex flex-wrap gap-3 text-ink-muted">
                    {formatsOf(slot.formats).map((format) => (
                      <span key={format.breakpoint}>
                        {t(`ads.breakpoint.${format.breakpoint}`)}:{" "}
                        {format.sizes.map((size) => `${size.width}×${size.height}`).join(", ")}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form action={saveSlotAction} className="mt-3 grid gap-3">
            <div className="grid gap-3 md:grid-cols-3">
              <Field label={t("ads.field.slotName")} htmlFor="slotName">
                <Input id="slotName" name="name" required maxLength={120} />
              </Field>
              <Field
                label={t("ads.field.code")}
                htmlFor="code"
                hint={t("ads.field.codeHint")}
              >
                <Input id="code" name="code" required placeholder={t("ads.field.codePlaceholder")} />
              </Field>
              <Field label={t("ads.field.slotStatus")} htmlFor="slotStatus">
                <Select id="slotStatus" name="status" defaultValue="draft">
                  <option value="draft">{t("ads.slotStatus.draft")}</option>
                  <option value="active">{t("ads.slotStatus.active")}</option>
                  <option value="retired">{t("ads.slotStatus.retired")}</option>
                </Select>
              </Field>
            </div>

            <fieldset className="grid gap-2 rounded-md border border-rule p-3">
              <legend className="px-1 font-mono text-xs text-ink-muted">
                {t("ads.field.sizes")}
              </legend>
              <p className="text-xs text-ink-muted">{t("ads.field.sizesHint")}</p>
              <div className="flex flex-wrap gap-3">
                {(sizeList ?? []).map((size) => (
                  <label key={size.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="size"
                      value={`${size.breakpoint}:${size.width}x${size.height}`}
                    />
                    <span>
                      {size.label} ({size.width}×{size.height})
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex flex-wrap items-end gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="lazy" value="1" defaultChecked />
                {t("ads.field.lazy")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="allowHouseFill" value="1" defaultChecked />
                {t("ads.field.houseFill")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="allowThirdParty" value="1" />
                {t("ads.field.thirdParty")}
              </label>
              <Button type="submit">{t("ads.action.saveSlot")}</Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("ads.advertisers")} />
        <CardBody>
          {buyers === null || buyers.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("ads.noAdvertisers")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {buyers.map((buyer) => (
                <li
                  key={buyer.contactId}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                >
                  <span className="font-medium">
                    {buyer.displayName ?? nameOf.get(buyer.contactId) ?? buyer.contactId}
                  </span>
                  {buyer.website ? (
                    <span className="text-ink-muted">{buyer.website}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <form action={saveAdvertiserAction} className="mt-3 grid gap-3 md:grid-cols-4">
            {/* Either an existing contact or an email. §4.16: an advertiser is
                a Contact, and `saveAdvertiser` resolves one either way, so the
                bakery buying a banner and the bakery buying prints stay one
                person. */}
            <Field label={t("ads.field.existing")} htmlFor="contactId">
              <Select id="contactId" name="contactId" defaultValue="">
                <option value="">—</option>
                {(people?.rows ?? []).map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t("ads.field.email")}
              htmlFor="email"
              hint={t("ads.field.emailHint")}
            >
              <Input id="email" name="email" type="email" />
            </Field>
            <Field label={t("ads.field.displayName")} htmlFor="displayName">
              <Input id="displayName" name="displayName" maxLength={200} />
            </Field>
            <Field label={t("ads.field.website")} htmlFor="website">
              <Input id="website" name="website" maxLength={400} />
            </Field>
            <div className="flex items-end">
              <Button type="submit">{t("ads.action.saveAdvertiser")}</Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("ads.campaigns")} />
        <CardBody>
          {sold === null || sold.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("ads.noCampaigns")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {sold.map((campaign) => (
                <li key={campaign.id} className="grid gap-2 rounded-md border border-rule p-3">
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="font-medium">{campaign.name}</span>
                    <span className="text-ink-muted">
                      {nameOf.get(campaign.advertiserContactId) ?? campaign.advertiserContactId}
                    </span>
                    <Pill tone={CAMPAIGN_TONE[campaign.status]}>
                      {t(`ads.campaignStatus.${campaign.status}`)}
                    </Pill>
                    <span className="text-ink-muted">
                      {t(`ads.pricing.${campaign.pricing}`)}
                      {campaign.pricing === "house" ? "" : ` · ${money(campaign.rateCents)}`}
                    </span>
                    {campaign.startsAt ? (
                      <span className="text-ink-muted">{when(campaign.startsAt)}</span>
                    ) : null}

                    {/* §4.16 bounds this by editorial honesty: a campaign is
                        approved or rejected before it may run, and the state
                        is visible rather than implied by the status. */}
                    <Pill
                      tone={
                        campaign.approvalState === "approved"
                          ? "success"
                          : campaign.approvalState === "rejected"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {t(`ads.approval.${campaign.approvalState}`)}
                    </Pill>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {campaign.approvalState !== "approved" ? (
                      <form action={decideCampaignAction}>
                        <input type="hidden" name="id" value={campaign.id} />
                        <input type="hidden" name="decision" value="approved" />
                        <Button type="submit" variant="quiet">
                          {t("ads.action.approve")}
                        </Button>
                      </form>
                    ) : null}
                    {campaign.approvalState !== "rejected" ? (
                      <form action={decideCampaignAction}>
                        <input type="hidden" name="id" value={campaign.id} />
                        <input type="hidden" name="decision" value="rejected" />
                        <Button type="submit" variant="quiet">
                          {t("ads.action.reject")}
                        </Button>
                      </form>
                    ) : null}
                    {(["live", "paused", "completed"] as const).map((status) => (
                      <form key={status} action={setCampaignStatusAction}>
                        <input type="hidden" name="id" value={campaign.id} />
                        <input type="hidden" name="status" value={status} />
                        <Button
                          type="submit"
                          variant="quiet"
                          disabled={campaign.status === status}
                        >
                          {t(`ads.action.${status}`)}
                        </Button>
                      </form>
                    ))}
                    <form method="get" className="ms-auto">
                      <input type="hidden" name="campaign" value={campaign.id} />
                      <Button type="submit" variant="quiet">
                        {t("ads.action.showLines")}
                      </Button>
                    </form>
                  </div>

                  {openCampaign === campaign.id ? (
                    <div className="grid gap-2 ps-3">
                      {items === null || items.length === 0 ? (
                        <p className="text-sm text-ink-muted">{t("ads.noLineItems")}</p>
                      ) : (
                        <ul className="grid list-none gap-1 p-0">
                          {items.map((item) => (
                            <li key={item.id} className="flex flex-wrap items-center gap-3 text-sm">
                              <span>{item.name}</span>
                              <span className="text-ink-muted tabular-nums">
                                {t("ads.weight", { n: String(item.weight) })}
                              </span>
                              <Pill tone={item.status === "active" ? "success" : "neutral"}>
                                {t(`ads.lineStatus.${item.status}`)}
                              </Pill>
                            </li>
                          ))}
                        </ul>
                      )}

                      <form action={saveLineItemAction} className="grid gap-3 md:grid-cols-4">
                        <input type="hidden" name="campaignId" value={campaign.id} />
                        <Field label={t("ads.field.lineName")} htmlFor={`ln-${campaign.id}`}>
                          <Input id={`ln-${campaign.id}`} name="name" required maxLength={160} />
                        </Field>
                        <Field
                          label={t("ads.field.slots")}
                          htmlFor={`ls-${campaign.id}`}
                          hint={t("ads.field.slotsHint")}
                        >
                          <select
                            id={`ls-${campaign.id}`}
                            name="slotIds"
                            multiple
                            required
                            size={3}
                            className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm"
                          >
                            {(positions ?? []).map((slot) => (
                              <option key={slot.id} value={slot.id}>
                                {slot.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label={t("ads.field.weight")} htmlFor={`lw-${campaign.id}`}>
                          <Input
                            id={`lw-${campaign.id}`}
                            name="weight"
                            type="number"
                            min={1}
                            defaultValue={1}
                          />
                        </Field>
                        <div className="flex items-end">
                          <Button type="submit" variant="quiet">
                            {t("ads.action.addLine")}
                          </Button>
                        </div>
                      </form>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <form action={saveCampaignAction} className="mt-3 grid gap-3 md:grid-cols-4">
            <Field label={t("ads.field.campaignName")} htmlFor="campaignName">
              <Input id="campaignName" name="name" required maxLength={160} />
            </Field>
            <Field label={t("ads.field.advertiser")} htmlFor="advertiserContactId">
              <Select id="advertiserContactId" name="advertiserContactId" required defaultValue="">
                <option value="">—</option>
                {(buyers ?? []).map((buyer) => (
                  <option key={buyer.contactId} value={buyer.contactId}>
                    {buyer.displayName ?? nameOf.get(buyer.contactId) ?? buyer.contactId}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("ads.field.pricing")} htmlFor="pricing">
              <Select id="pricing" name="pricing" defaultValue="house">
                <option value="house">{t("ads.pricing.house")}</option>
                <option value="cpm">{t("ads.pricing.cpm")}</option>
                <option value="cpc">{t("ads.pricing.cpc")}</option>
                <option value="flat">{t("ads.pricing.flat")}</option>
              </Select>
            </Field>
            <Field
              label={t("ads.field.rate")}
              htmlFor="rateCents"
              hint={t("ads.field.rateHint")}
            >
              <Input id="rateCents" name="rateCents" type="number" min={0} defaultValue={0} />
            </Field>
            <Field label={t("ads.field.startsAt")} htmlFor="startsAt">
              <Input id="startsAt" name="startsAt" type="date" />
            </Field>
            <Field label={t("ads.field.endsAt")} htmlFor="endsAt">
              <Input id="endsAt" name="endsAt" type="date" />
            </Field>
            <Field label={t("ads.field.budget")} htmlFor="budgetCents">
              <Input id="budgetCents" name="budgetCents" type="number" min={0} />
            </Field>
            <div className="flex items-end">
              <Button type="submit">{t("ads.action.saveCampaign")}</Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
