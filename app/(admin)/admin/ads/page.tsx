// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Ads: the positions you sell, who buys them, what runs, and the bill
// (C9.17–C9.18, MASTER.md §4.16).
//
// Inventory first, buyers second, campaigns third — the order a publisher
// actually works in. You cannot sell a slot that does not exist, and §4.16's
// point about reserved space is a property of the slot rather than of the sale.
//
// C9.18 gives the sale something to show. Creatives hang off a line item, in
// the size the position actually declares; a paid one needs reviewing before it
// appears and drops back to needing it on every edit, because §4.16's rule is
// that "a creative cannot be swapped for a different target after approval".
// The invoice button is here rather than in the money screen for the same
// reason the advertiser is a Contact: selling an ad is selling a product, and
// the owner is standing in front of the campaign when they decide to bill it.
//
// What is still missing is the counting — impressions, viewability and the
// daily rollup are C9.19 — so the screen says so rather than leaving an owner
// to wonder why a live campaign reports nothing.
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
import { listAssets } from "@/core/media/service";
import {
  advertiserList,
  campaigns,
  creatives as campaignCreatives,
  lineItems,
  sizes,
  slots,
} from "@/modules/ads/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import {
  decideCampaignAction,
  invoiceCampaignAction,
  reviewCreativeAction,
  saveAdvertiserAction,
  saveCampaignAction,
  saveCreativeAction,
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

/** The slot ids a line item names, read defensively — it is jsonb. */
function slotIdsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
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
  const [items, art, images] = openCampaign
    ? await Promise.all([
        domainOrNull(lineItems.call({ campaignId: openCampaign }, actor)),
        domainOrNull(campaignCreatives.call({ campaignId: openCampaign }, actor)),
        domainOrNull(listAssets.call({ kind: "image", limit: 100 }, actor)),
      ])
    : [null, null, null];

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

      {/* Said once, plainly. Ads run now; nothing is counted yet, and a live
          campaign reporting nothing is otherwise read as a bug rather than as
          the next piece of work. */}
      <Callout tone="neutral">{t("ads.notCountingYet")}</Callout>

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
                    {/* Selling an ad is selling a product (§4.16), so the
                        bill is raised here and issued from the invoice, where
                        the tax question is asked properly. */}
                    {campaign.invoiceId ? (
                      <a
                        href={`/admin/invoices/${campaign.invoiceId}`}
                        className="text-sm font-semibold text-accent underline"
                      >
                        {t("ads.action.openInvoice")}
                      </a>
                    ) : campaign.pricing === "house" ? null : (
                      <form action={invoiceCampaignAction}>
                        <input type="hidden" name="id" value={campaign.id} />
                        <Button type="submit" variant="quiet">
                          {t("ads.action.invoice")}
                        </Button>
                      </form>
                    )}
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
                        <ul className="grid list-none gap-3 p-0">
                          {items.map((item) => {
                            // Only the sizes this line item's own positions
                            // declare. Offering every IAB size would let an
                            // owner build a creative that can never run.
                            const declared = new Map<string, string>();
                            for (const slotId of slotIdsOf(item.slotIds)) {
                              const slot = (positions ?? []).find((each) => each.id === slotId);
                              for (const format of formatsOf(slot?.formats)) {
                                for (const size of format.sizes) {
                                  declared.set(
                                    `${size.width}x${size.height}`,
                                    `${size.width}×${size.height}`,
                                  );
                                }
                              }
                            }
                            const artwork = (art ?? []).filter(
                              (creative) => creative.lineItemId === item.id,
                            );
                            return (
                              <li
                                key={item.id}
                                className="grid gap-2 rounded-md border border-rule p-3"
                              >
                                <div className="flex flex-wrap items-center gap-3 text-sm">
                                  <span className="font-medium">{item.name}</span>
                                  <span className="text-ink-muted tabular-nums">
                                    {t("ads.weight", { n: String(item.weight) })}
                                  </span>
                                  <Pill tone={item.status === "active" ? "success" : "neutral"}>
                                    {t(`ads.lineStatus.${item.status}`)}
                                  </Pill>
                                </div>

                                {artwork.length === 0 ? (
                                  <p className="text-sm text-ink-muted">{t("ads.noCreatives")}</p>
                                ) : (
                                  <ul className="grid list-none gap-1 p-0">
                                    {artwork.map((creative) => (
                                      <li
                                        key={creative.id}
                                        className="flex flex-wrap items-center gap-3 text-sm"
                                      >
                                        <span>
                                          {creative.headline ?? creative.altText ?? creative.clickUrl}
                                        </span>
                                        <span className="text-ink-muted tabular-nums">
                                          {creative.width}×{creative.height}
                                        </span>
                                        <Pill
                                          tone={creative.status === "active" ? "success" : "neutral"}
                                        >
                                          {t(`ads.creativeStatus.${creative.status}`)}
                                        </Pill>
                                        {/* §4.16: a creative carries its own
                                            review state, separate from the
                                            approval of the sale. */}
                                        <Pill
                                          tone={
                                            creative.reviewState === "approved"
                                              ? "success"
                                              : creative.reviewState === "rejected"
                                                ? "danger"
                                                : "warning"
                                          }
                                        >
                                          {t(`ads.review.${creative.reviewState}`)}
                                        </Pill>
                                        {(["approved", "rejected"] as const).map((decision) => (
                                          <form key={decision} action={reviewCreativeAction}>
                                            <input type="hidden" name="id" value={creative.id} />
                                            <input type="hidden" name="decision" value={decision} />
                                            <Button
                                              type="submit"
                                              variant="quiet"
                                              disabled={creative.reviewState === decision}
                                            >
                                              {decision === "approved"
                                                ? t("ads.action.approve")
                                                : t("ads.action.reject")}
                                            </Button>
                                          </form>
                                        ))}
                                      </li>
                                    ))}
                                  </ul>
                                )}

                                {declared.size === 0 ? (
                                  <p className="text-sm text-ink-muted">
                                    {t("ads.noSizesDeclared")}
                                  </p>
                                ) : (
                                  <form
                                    action={saveCreativeAction}
                                    className="grid gap-3 md:grid-cols-4"
                                  >
                                    <input type="hidden" name="lineItemId" value={item.id} />
                                    <Field
                                      label={t("ads.field.creativeKind")}
                                      htmlFor={`ck-${item.id}`}
                                    >
                                      <Select id={`ck-${item.id}`} name="kind" defaultValue="image">
                                        <option value="image">{t("ads.creativeKind.image")}</option>
                                        <option value="native">
                                          {t("ads.creativeKind.native")}
                                        </option>
                                      </Select>
                                    </Field>
                                    <Field
                                      label={t("ads.field.creativeSize")}
                                      htmlFor={`cz-${item.id}`}
                                    >
                                      <Select id={`cz-${item.id}`} name="size" required defaultValue="">
                                        <option value="">—</option>
                                        {[...declared].map(([value, label]) => (
                                          <option key={value} value={value}>
                                            {label}
                                          </option>
                                        ))}
                                      </Select>
                                    </Field>
                                    <Field
                                      label={t("ads.field.image")}
                                      htmlFor={`ci-${item.id}`}
                                      hint={t("ads.field.imageHint")}
                                    >
                                      <Select id={`ci-${item.id}`} name="assetId" defaultValue="">
                                        <option value="">—</option>
                                        {(images?.rows ?? []).map((asset) => (
                                          <option key={asset.id} value={asset.id}>
                                            {asset.filename}
                                          </option>
                                        ))}
                                      </Select>
                                    </Field>
                                    <Field
                                      label={t("ads.field.clickUrl")}
                                      htmlFor={`cu-${item.id}`}
                                      hint={t("ads.field.clickUrlHint")}
                                    >
                                      <Input
                                        id={`cu-${item.id}`}
                                        name="clickUrl"
                                        type="url"
                                        required
                                      />
                                    </Field>
                                    <Field
                                      label={t("ads.field.altText")}
                                      htmlFor={`ca-${item.id}`}
                                      hint={t("ads.field.altTextHint")}
                                    >
                                      <Input id={`ca-${item.id}`} name="altText" maxLength={300} />
                                    </Field>
                                    <Field
                                      label={t("ads.field.headline")}
                                      htmlFor={`ch-${item.id}`}
                                    >
                                      <Input id={`ch-${item.id}`} name="headline" maxLength={200} />
                                    </Field>
                                    <Field
                                      label={t("ads.field.ctaLabel")}
                                      htmlFor={`cc-${item.id}`}
                                    >
                                      <Input id={`cc-${item.id}`} name="ctaLabel" maxLength={60} />
                                    </Field>
                                    <Field
                                      label={t("ads.field.creativeStatus")}
                                      htmlFor={`cs-${item.id}`}
                                    >
                                      <Select id={`cs-${item.id}`} name="status" defaultValue="active">
                                        <option value="draft">
                                          {t("ads.creativeStatus.draft")}
                                        </option>
                                        <option value="active">
                                          {t("ads.creativeStatus.active")}
                                        </option>
                                        <option value="paused">
                                          {t("ads.creativeStatus.paused")}
                                        </option>
                                      </Select>
                                    </Field>
                                    <div className="flex items-end">
                                      <Button type="submit" variant="quiet">
                                        {t("ads.action.addCreative")}
                                      </Button>
                                    </div>
                                  </form>
                                )}
                              </li>
                            );
                          })}
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
