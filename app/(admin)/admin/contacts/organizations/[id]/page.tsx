// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { notFound } from "next/navigation";
import { getOrganization } from "@/core/contacts/organizations";
import { listCustomFields } from "@/core/contacts/custom-fields";
import { listContacts } from "@/core/contacts/service";
import { ServiceError, hasModuleAccess } from "@/core/service";
import { Card, CardBody, CardHeader } from "@/ui/primitives";
import { getT } from "../../../../../i18n";
import { requireStaffActor } from "../../../guard";
import { OrganizationForm } from "../OrganizationForm";
import { organizationLabels } from "../labels";

export const dynamic = "force-dynamic";

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireStaffActor("contacts");
  const { id } = await params;
  const organization = await getOrganization.call({ id }, actor).catch((error: unknown) => {
    if (error instanceof ServiceError) notFound();
    throw error;
  });
  const [t, definitions, members] = await Promise.all([
    getT(),
    listCustomFields.call({ entity: "organization" }, actor),
    listContacts.call({ organizationId: id, limit: 100 }, actor),
  ]);
  const canManage = hasModuleAccess(actor, "contacts", "manage");
  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/contacts/organizations" className="text-sm text-ink-muted">
          {t("contacts.organizations.back")}
        </a>
        <h1 className="mt-2 text-xl font-bold tracking-tight">{organization.name}</h1>
      </div>
      <OrganizationForm
        values={{
          id: organization.id,
          name: organization.name,
          domain: organization.domain ?? "",
          customFields: organization.customFields as Record<string, unknown>,
        }}
        definitions={definitions}
        labels={organizationLabels(t)}
        readOnly={!canManage}
      />
      <Card>
        <CardHeader title={t("contacts.organizations.members")} />
        <CardBody>
          {members.total === 0 ? (
            <p className="text-sm text-ink-muted">
              {t("contacts.organizations.membersEmpty")}
            </p>
          ) : (
            <ul className="grid list-none gap-0 p-0">
              {members.rows.map((contact) => (
                <li key={contact.id} className="border-b border-rule py-2.5 last:border-0">
                  <a
                    href={`/admin/contacts/${contact.id}`}
                    className="text-sm font-medium underline decoration-rule underline-offset-2"
                  >
                    {contact.name}
                  </a>
                  {contact.email ? (
                    <span className="ms-3 text-xs text-ink-muted">{contact.email}</span>
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
