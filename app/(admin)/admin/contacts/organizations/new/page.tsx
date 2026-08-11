// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
import { listCustomFields } from "@/core/contacts/custom-fields";
import { getT } from "../../../../../i18n";
import { requireStaffActor } from "../../../guard";
import { OrganizationForm } from "../OrganizationForm";
import { organizationLabels } from "../labels";

export const dynamic = "force-dynamic";

export default async function NewOrganizationPage() {
  const actor = await requireStaffActor("contacts", "manage");
  const [t, definitions] = await Promise.all([
    getT(),
    listCustomFields.call({ entity: "organization" }, actor),
  ]);
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">
          {t("contacts.organizations.new")}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {t("contacts.organizations.newIntro")}
        </p>
      </div>
      <OrganizationForm
        values={{ name: "", domain: "", customFields: {} }}
        definitions={definitions}
        labels={organizationLabels(t)}
        readOnly={false}
      />
    </div>
  );
}
