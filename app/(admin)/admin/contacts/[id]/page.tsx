// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
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
import { hasModuleAccess, ServiceError } from "@/core/service";
import { listOrders, listWishlist } from "@/modules/catalog/service";
import { listInvoices } from "@/modules/invoicing/invoice-service";
import { Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { invoiceTone, money } from "../../invoices/format";
import { getT } from "../../../../i18n";
import { contactFormLabels, mergePanelLabels } from "../contactLabels";
import { ContactForm } from "../ContactForm";
import { MergePanel } from "./MergePanel";
import { requireStaffActor } from "../../guard";
import { currentBusiness } from "@/core/settings/read";
import { listOrganizations } from "@/core/contacts/organizations";
import { listCustomFields } from "@/core/contacts/custom-fields";
import { listRelationships } from "@/core/contacts/relationships";
import { RelationshipPanel } from "./RelationshipPanel";
import { NotesPanel } from "../../NotesPanel";
import { ScorePanel } from "../../ScorePanel";
import { ConversationsPanel } from "../../ConversationsPanel";

export const dynamic = "force-dynamic";


/** Known Contact events are translated; module events retain a readable fallback. */
function describe(eventType: string, t: Translate): string {
  const contactEvent = /^contact\.(.+)$/.exec(eventType)?.[1];
  if (
    contactEvent &&
    [
      "created",
      "updated",
      "merged",
      "mergeUndone",
      "magicLinkRequested",
      "portalAccountLinked",
      "magicLinkSignedIn",
      "lifecycleChanged",
      "relationshipAdded",
      "relationshipUpdated",
      "relationshipRemoved",
    ].includes(contactEvent)
  ) {
    return t(`contacts.timeline.event.${contactEvent}`);
  }
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
  const actor = await requireStaffActor("contacts");
  const { id } = await params;
  const query = await searchParams;
  const mergeQuery = (
    Array.isArray(query.merge) ? query.merge[0] : query.merge
  )?.trim();
  const relatedQuery = (
    Array.isArray(query.related) ? query.related[0] : query.related
  )?.trim();

  const contact = await getContact.call({ id }, actor).catch((error: unknown) => {
    // A bad id in the address bar is a 404, not a 500 — and a malformed one
    // fails Zod before it ever reaches the database.
    if (error instanceof ServiceError) notFound();
    throw error;
  });

  const canSeeInvoices = hasModuleAccess(actor, "invoicing");
  const canSeeCatalog = hasModuleAccess(actor, "catalog");
  const [
    business,
    timeline,
    t,
    organizationResult,
    customFields,
    relationships,
    invoices,
    orders,
    wishlist,
  ] = await Promise.all([
    currentBusiness(),
    contactTimeline.call({ contactId: contact.id }, actor),
    getT(),
    listOrganizations.call({ limit: 100 }, actor),
    listCustomFields.call({ entity: "contact" }, actor),
    listRelationships.call({ contactId: contact.id }, actor),
    canSeeInvoices
      ? listInvoices.call({ contactId: contact.id, limit: 25 }, actor)
      : Promise.resolve([]),
    canSeeCatalog ? listOrders.call({ contactId: contact.id }, actor) : Promise.resolve([]),
    canSeeCatalog
      ? listWishlist.call({ contactId: contact.id }, actor)
      : Promise.resolve({ wishlist: null, items: [] }),
  ]);

  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";

  const canMerge = hasModuleAccess(actor, "contacts", "manage");
  const candidates =
    canMerge && mergeQuery
      ? (await listContacts.call({ search: mergeQuery, limit: 10 }, actor)).rows
          .filter((row) => row.id !== contact.id)
          .map((row) => ({ id: row.id, name: row.name, email: row.email }))
      : [];
  const relatedIds = new Set(
    relationships.map((relationship) => relationship.otherContact.id),
  );
  const relationshipCandidates =
    canMerge && relatedQuery
      ? (
          await listContacts.call(
            { search: relatedQuery, limit: 10 },
            actor,
          )
        ).rows
          .filter((row) => row.id !== contact.id && !relatedIds.has(row.id))
          .map((row) => ({ id: row.id, name: row.name, email: row.email }))
      : [];

  const relationshipLabels: Record<string, string> = {
    title: t("contacts.relationships.title"),
    intro: t("contacts.relationships.intro"),
    empty: t("contacts.relationships.empty"),
    search: t("contacts.relationships.search"),
    find: t("common.search"),
    noResults: t("contacts.relationships.noResults", {
      query: relatedQuery ?? "",
    }),
    person: t("contacts.relationships.person"),
    kind: t("contacts.relationships.kind"),
    since: t("contacts.relationships.since"),
    notes: t("contacts.relationships.notes"),
    add: t("contacts.relationships.add"),
    save: t("common.saveChanges"),
    remove: t("contacts.relationships.remove"),
  };
  for (const kind of ["household", "employer", "referred_by", "partner", "guardian"] as const) {
    relationshipLabels[`kind.${kind}`] = t(`contacts.relationships.kind.${kind}`);
    relationshipLabels[`create.${kind}`] = t(`contacts.relationships.create.${kind}`);
    for (const direction of ["peer", "outgoing", "incoming"] as const) {
      relationshipLabels[`display.${kind}.${direction}`] = t(
        `contacts.relationships.display.${kind}.${direction}`,
      );
    }
  }

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
        readOnly={!canMerge}
        labels={contactFormLabels(t)}
        organizations={organizationResult.rows}
        customFields={customFields}
        values={{
          id: contact.id,
          name: contact.name,
          email: contact.email ?? "",
          phone: contact.phone ?? "",
          orgId: contact.orgId ?? "",
          lifecycleStage: contact.lifecycleStage,
          tags: contact.tags,
          preferredLocale: contact.preferredLocale ?? "",
          timezone: contact.timezone ?? "",
          country: contact.country ?? "",
          customFields: contact.customFields as Record<string, unknown>,
          ownerNotes: contact.ownerNotes ?? "",
        }}
      />

      {canSeeCatalog ? (
        <Card>
          <CardHeader title={t("catalog.orders.contactHistory")} />
          <CardBody>
            {orders.length === 0 ? (
              <p className="text-sm text-ink-muted">{t("catalog.orders.contactHistory.empty")}</p>
            ) : (
              <ul className="grid list-none gap-3 p-0">
                {orders.map((order) => (
                  <li key={order.id}>
                    <a href={`/admin/orders/${order.id}`} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold">{order.id.slice(0, 8)}</span>
                      <Pill>{t(`catalog.orders.status.${order.status}`)}</Pill>
                      <span className="ms-auto font-mono">{money(order.totalMinor, order.currency)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {wishlist.items.length ? (
              <p className="mt-4 text-sm text-ink-muted">
                {t("catalog.carts.wishlist")}: {wishlist.items.map((item) => item.sku).join(", ")}
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {canSeeInvoices ? (
        <Card>
          <CardHeader title={t("invoices.contactHistory")} />
          <CardBody>
            {invoices.length === 0 ? (
              <p className="text-sm text-ink-muted">{t("invoices.contactHistory.empty")}</p>
            ) : (
              <ul className="grid list-none gap-3 p-0">
                {invoices.map((invoice) => (
                  <li key={invoice.id}>
                    <a
                      href={`/admin/invoices/${invoice.id}`}
                      className="flex flex-wrap items-center gap-2 text-sm"
                    >
                      <span className="font-semibold">{invoice.number ?? t("invoices.draftNumber")}</span>
                      <Pill tone={invoiceTone(invoice.status)}>{t(`invoices.status.${invoice.status}`)}</Pill>
                      <span className="ms-auto font-mono">{money(invoice.totalMinor, invoice.currency)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {hasModuleAccess(actor, "invoicing", "manage") ? (
              <a
                href={`/admin/invoices/new?contactId=${contact.id}`}
                className="mt-3 inline-block text-sm font-semibold text-accent"
              >
                {t("invoices.contactHistory.create")}
              </a>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <RelationshipPanel
        contactId={contact.id}
        query={relatedQuery ?? ""}
        candidates={relationshipCandidates}
        relationships={relationships}
        labels={relationshipLabels}
        canManage={canMerge}
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

      {/* The score, then its reasons, then the notes, then the timeline: a
          number, why it is that number, what people said, and what happened
          (C7.05). */}
      <ScorePanel actor={actor} contactId={contact.id} locale={locale} timezone={timezone} />

      {/* What they actually said, whatever door it came through (C7.08). */}
      <ConversationsPanel
        actor={actor}
        contactId={contact.id}
        locale={locale}
        timezone={timezone}
      />

      {/* Notes above the timeline: what somebody wrote about this person is
          what you want before you read what happened to them (C7.03). */}
      <NotesPanel
        actor={actor}
        subjectType="contact"
        subjectId={contact.id}
        returnTo={`/admin/contacts/${contact.id}`}
        locale={locale}
        timezone={timezone}
      />

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
                    {describe(event.eventType, t)}
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
