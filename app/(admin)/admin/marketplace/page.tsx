// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Marketplace channel sync (MASTER.md §36, C3.13).
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { listMarketplaceChannels } from "../../../../plugins/marketplace/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import { connectMarketplaceAction, syncMarketplaceAction } from "../../first-party-plugin-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("marketplace", "manage");
  const query = await searchParams;
  const [t, channels] = await Promise.all([
    getT(),
    domainOrNull(listMarketplaceChannels.call({}, actor)),
  ]);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("marketplace.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("marketplace.intro")}</p>
      </div>
      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("marketplace.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error}
        </p>
      ) : null}
      <Card>
        <CardHeader title={t("marketplace.connect")} />
        <CardBody>
          <form action={connectMarketplaceAction} className="grid gap-3 sm:grid-cols-2">
            <Field label={t("marketplace.field.name")} htmlFor="mkt-name">
              <Input id="mkt-name" name="name" required />
            </Field>
            <Field label={t("marketplace.field.provider")} htmlFor="mkt-provider">
              <Select id="mkt-provider" name="provider" defaultValue="shopify">
                <option value="shopify">{t("marketplace.provider.shopify")}</option>
                <option value="etsy">{t("marketplace.provider.etsy")}</option>
                <option value="amazon">{t("marketplace.provider.amazon")}</option>
                <option value="ebay">{t("marketplace.provider.ebay")}</option>
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit">{t("marketplace.connect")}</Button>
            </div>
          </form>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("marketplace.list")} />
        <CardBody>
          {(channels ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">{t("marketplace.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {(channels ?? []).map((channel) => (
                <li key={channel.id} className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm">
                  <span>{channel.name}</span>
                  <Pill tone={channel.status === "connected" ? "success" : channel.status === "failed" ? "danger" : "neutral"}>
                    {t(`marketplace.status.${channel.status}`)}
                  </Pill>
                  {channel.lastError ? <span className="text-danger">{channel.lastError}</span> : null}
                  {channel.status === "failed" || channel.status === "pending" ? (
                    <form action={connectMarketplaceAction}>
                      <input type="hidden" name="channelId" value={channel.id} />
                      <input type="hidden" name="name" value={channel.name} />
                      <input type="hidden" name="provider" value={channel.provider} />
                      <Button type="submit" variant="quiet">
                        {t("marketplace.retry")}
                      </Button>
                    </form>
                  ) : null}
                  {channel.status === "connected" ? (
                    <form action={syncMarketplaceAction}>
                      <input type="hidden" name="channelId" value={channel.id} />
                      <Button type="submit" variant="quiet">
                        {t("marketplace.sync")}
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
