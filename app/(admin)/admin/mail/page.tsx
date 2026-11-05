// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The private preview outbox (MASTER.md §43 C3.36).
//
// Mail a preview may not deliver is held, never sent. This is where the owner
// reads it — a customer's sign-in link included — through the same services
// the API offers: `mail.listHeld` for the list, the audited `mail.openHeld`
// for one body. Staff with mail access only; customers and the public never
// reach a held message.
import type { Metadata } from "next";
import { Tray } from "@phosphor-icons/react/dist/ssr";
import { listHeldMail } from "@/core/mail/preview";
import { hasModuleAccess } from "@/core/service";
import { currentBusiness } from "@/core/settings/read";
import { formatDateTime } from "@/core/i18n";
import { Callout, Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { HeldMailReader } from "./HeldMailReader";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PreviewOutboxPage() {
  const actor = await requireStaffActor("mail");
  const [outbox, business, t] = await Promise.all([
    listHeldMail.call({ limit: 50 }, actor),
    currentBusiness(),
    getT(),
  ]);
  const canOpen = hasModuleAccess(actor, "mail", "manage");
  const reasons = {
    recipient: t("mail.preview.reason.recipient"),
    cap: t("mail.preview.reason.cap"),
    no_adapter: t("mail.preview.reason.noAdapter"),
  } as const;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("mail.preview.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("mail.preview.intro")}</p>
      </div>

      <Callout tone={outbox.preview ? "accent" : "neutral"} icon={<Tray size={17} />}>
        {outbox.preview
          ? t("mail.preview.active", {
              sent: outbox.sentLast24Hours,
              cap: outbox.dailyCap,
              allowed: outbox.allowList.length > 0 ? outbox.allowList.join(", ") : t("mail.preview.noAllowList"),
            })
          : t("mail.preview.inactive")}
      </Callout>

      <Card>
        <CardHeader title={t("mail.preview.held")} status={<Pill tone="neutral">{outbox.held.length}</Pill>} />
        <CardBody>
          {outbox.held.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("mail.preview.empty")}</p>
          ) : (
            <ul className="grid list-none gap-5 p-0">
              {outbox.held.map((message) => (
                <li key={message.id} className="grid gap-2 border-b border-rule pb-5 last:border-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{message.subject}</span>
                    <Pill tone="warning">{reasons[message.reason]}</Pill>
                  </div>
                  <p className="text-xs text-ink-muted">
                    <span className="font-mono text-ink">{message.recipient}</span>
                    {" · "}
                    {formatDateTime(message.createdAt, business?.timezone ?? "UTC", business?.defaultLocale ?? "en")}
                  </p>
                  {!message.readable ? (
                    <p className="text-sm text-ink-muted">{t("mail.preview.expired")}</p>
                  ) : canOpen ? (
                    <HeldMailReader
                      id={message.id}
                      labels={{
                        open: t("mail.preview.open"),
                        opening: t("mail.preview.opening"),
                        to: t("mail.preview.to"),
                      }}
                    />
                  ) : (
                    <p className="text-sm text-ink-muted">{t("mail.preview.manageToOpen")}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
