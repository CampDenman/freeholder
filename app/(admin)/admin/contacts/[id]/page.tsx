// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// One contact, with the CRM timeline beside it (§4.1). The timeline is a view
// over the spine rather than a separate store: modules write events as things
// happen, and this reads them back without knowing what any of them mean.
import { notFound } from "next/navigation";
import { ClockCounterClockwise } from "@phosphor-icons/react/dist/ssr";
import {
  contactTimeline,
  getContact,
  listContacts,
} from "@/core/contacts/service";
import { formatDateTime, type Translate } from "@/core/i18n";
import { getBusiness } from "@/core/settings/service";
import { ServiceError } from "@/core/service";
import { Card, CardBody, CardHeader } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { contactFormLabels, mergePanelLabels } from "../contactLabels";
import { ContactForm } from "../ContactForm";
import { MergePanel } from "./MergePanel";
import { requireStaffActor } from "../../guard";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;

/** "contact.created" → "Contact created", for someone who did not build this. */
function describe(eventType: string): string {
  const [subject, ...rest] = eventType.split(".");
  if (!subject || rest.length === 0) return eventType;
  const verb = rest.join(" ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return `${subject.charAt(0).toUpperCase()}${subject.slice(1)} ${verb}`;
}

function actorLabel(actor: string, t: Translate): string {
  if (actor.startsWith("agent:")) {
    return t("actor.agent", { name: actor.slice(6) });
  }
  if (actor.startsWith("user:")) return t("actor.staff");
  if (actor === "system") return t("actor.system");
  return t("actor.visitor");
}

export default async function ContactDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireStaffActor();
  const { id } = await params;
  const query = await searchParams;
  const mergeQuery = (
    Array.isArray(query.merge) ? query.merge[0] : query.merge
  )?.trim();

  const contact = await getContact.call({ id }, actor).catch((error: unknown) => {
    // A bad id in the address bar is a 404, not a 500 — and a malformed one
    // fails Zod before it ever reaches the database.
    if (error instanceof ServiceError) notFound();
    throw error;
  });

  const [business, timeline, t] = await Promise.all([
    getBusiness.call({}, ANONYMOUS),
    contactTimeline.call({ contactId: contact.id }, actor),
    getT(),
  ]);

  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";

  // Merging destroys a record, so it is owner-only at the service; not
  // rendering the panel for staff saves them discovering that by being refused.
  const canMerge = actor.kind === "user" && actor.role === "owner";
  const candidates =
    canMerge && mergeQuery
      ? (await listContacts.call({ search: mergeQuery, limit: 10 }, actor)).rows
          .filter((row) => row.id !== contact.id)
          .map((row) => ({ id: row.id, name: row.name, email: row.email }))
      : [];

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/contacts" className="text-sm text-ink-muted">
          {t("contacts.detail.back")}
        </a>
        <h1 className="mt-2 text-xl font-bold tracking-tight">
          {contact.name}
        </h1>
        <p className="mt-1 font-mono text-xs text-ink-muted">
          {t("contacts.detail.added", {
            when: formatDateTime(contact.createdAt, timezone, locale),
          })}
        </p>
      </div>

      <ContactForm
        labels={contactFormLabels(t)}
        values={{
          id: contact.id,
          name: contact.name,
          email: contact.email ?? "",
          phone: contact.phone ?? "",
          lifecycleStage: contact.lifecycleStage,
          tags: contact.tags,
          ownerNotes: contact.ownerNotes ?? "",
        }}
      />

      {canMerge ? (
        <MergePanel
          survivingId={contact.id}
          query={mergeQuery ?? ""}
          candidates={candidates}
          labels={mergePanelLabels(t)}
          noResults={t("contacts.merge.noResults", {
            query: mergeQuery ?? "",
          })}
        />
      ) : null}

      <Card>
        <CardHeader
          icon={<ClockCounterClockwise size={17} weight="bold" />}
          title={t("contacts.detail.timeline")}
        />
        <CardBody>
          {timeline.length === 0 ? (
            <p className="text-sm text-ink-muted">
              {t("contacts.detail.timelineEmpty")}
            </p>
          ) : (
            <ol className="grid list-none gap-0 p-0">
              {timeline.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-rule py-2.5 last:border-b-0"
                >
                  <span className="text-sm font-medium">
                    {describe(event.eventType)}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {actorLabel(event.actor, t)}
                  </span>
                  <time
                    dateTime={event.occurredAt.toISOString()}
                    className="ms-auto font-mono text-xs text-ink-muted tabular-nums"
                  >
                    {formatDateTime(event.occurredAt, timezone, locale)}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
