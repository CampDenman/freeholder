// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Campaigns: one message to many people (C9.06, MASTER.md §30).
//
// A broadcast is deliberately three things an owner already has — a template
// (C9.05), a segment (§30's unit of "who") and a moment — so this page is a
// list and a short form rather than an editor. The wording is edited where
// wording lives, and the audience where audiences live.
import type { Metadata } from "next";
import Link from "next/link";
import { Megaphone } from "@phosphor-icons/react/dist/ssr";
import { Button, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { listSegments } from "@/core/segments/service";
import { listBroadcasts, listTemplates } from "@/modules/newsletters/service";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { domainOrNull } from "../../../read-helpers";
import { saveBroadcastAction } from "../../../broadcast-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Draft and scheduled are the states an owner can still change their mind in. */
const TONE = {
  draft: "neutral",
  scheduled: "accent",
  sending: "accent",
  sent: "success",
  paused: "warning",
  cancelled: "neutral",
} as const;

export default async function BroadcastsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireStaffActor("newsletters", "manage");
  const query = await searchParams;
  const [t, business, rows, templates, segments] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(listBroadcasts.call({}, actor)),
    domainOrNull(listTemplates.call({}, actor)),
    domainOrNull(listSegments.call({}, actor)),
  ]);

  // Campaign wording, not receipts: sending an invoice template to a list is
  // never what somebody meant, so it is not offered.
  const sendable = (templates ?? []).filter(
    (each) => each.kind === "campaign" || each.kind === "newsletter",
  );
  const locale = business?.defaultLocale ?? "en";
  // Shown in the business's own timezone, not the server's: a send time an
  // owner set for nine o'clock must read as nine o'clock.
  const timezone = business?.timezone ?? "UTC";
  const when = (value: Date | string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(new Date(value));

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/newsletters" className="text-sm underline">
          {t("broadcasts.back")}
        </Link>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <Megaphone size={22} weight="duotone" className="text-accent" />
          {t("broadcasts.title")}
        </h1>
      </div>
      <p className="max-w-prose text-sm text-ink-muted">{t("broadcasts.intro")}</p>

      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("broadcasts.new")} />
        <CardBody>
          {sendable.length === 0 || (segments ?? []).length === 0 ? (
            // Said plainly rather than shown as an empty dropdown, which reads
            // as a broken page instead of as a step not done yet.
            <p className="text-sm text-ink-muted">
              {t("broadcasts.needsParts")}{" "}
              <Link href="/admin/newsletters/templates" className="underline">
                {t("broadcasts.needsTemplate")}
              </Link>{" "}
              <Link href="/admin/segments" className="underline">
                {t("broadcasts.needsSegment")}
              </Link>
            </p>
          ) : (
            <form action={saveBroadcastAction} className="grid gap-3">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label={t("broadcasts.field.name")} htmlFor="name">
                  <Input id="name" name="name" required maxLength={200} />
                </Field>
                <Field
                  label={t("broadcasts.field.subject")}
                  htmlFor="subject"
                  hint={t("broadcasts.field.subjectHint")}
                >
                  <Input id="subject" name="subject" maxLength={300} />
                </Field>
                <Field label={t("broadcasts.field.template")} htmlFor="templateId">
                  <Select id="templateId" name="templateId" required>
                    {sendable.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label={t("broadcasts.field.audience")}
                  htmlFor="segmentId"
                  hint={t("broadcasts.field.audienceHint")}
                >
                  <Select id="segmentId" name="segmentId" required>
                    {(segments ?? []).map((segment) => (
                      <option key={segment.id} value={segment.id}>
                        {segment.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label={t("broadcasts.field.scheduledAt")}
                  htmlFor="scheduledAt"
                  hint={t("broadcasts.field.scheduledAtHint")}
                >
                  <Input id="scheduledAt" name="scheduledAt" type="datetime-local" />
                </Field>
              </div>
              <div>
                <Button type="submit">{t("broadcasts.action.create")}</Button>
              </div>
            </form>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("broadcasts.all")} />
        <CardBody>
          {(rows ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">{t("broadcasts.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {(rows ?? []).map((broadcast) => (
                <li
                  key={broadcast.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                >
                  <Link
                    href={`/admin/newsletters/broadcasts/${broadcast.id}`}
                    className="font-semibold text-ink underline"
                  >
                    {broadcast.name}
                  </Link>
                  <Pill tone={TONE[broadcast.status]}>
                    {t(`broadcasts.status.${broadcast.status}`)}
                  </Pill>
                  {/* The frozen audience, once there is one to state. */}
                  {broadcast.audienceCount > 0 ? (
                    <span className="text-ink-muted">
                      {t("broadcasts.audienceCount", { count: broadcast.audienceCount })}
                    </span>
                  ) : null}
                  <span className="ms-auto text-ink-muted">
                    {when(broadcast.scheduledAt ?? broadcast.updatedAt)}
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
