// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Deliberate entry by a human. Automated paths use contacts.resolve instead,
// so a form submission never mints a second record for somebody already known.
import { getT } from "../../../../i18n";
import { contactFormLabels } from "../contactLabels";
import { ContactForm } from "../ContactForm";
import { requireStaffActor } from "../../guard";
import { listOrganizations } from "@/core/contacts/organizations";
import { listCustomFields } from "@/core/contacts/custom-fields";

export const dynamic = "force-dynamic";

export default async function NewContactPage() {
  const actor = await requireStaffActor("contacts", "manage");
  const [t, organizationResult, customFields] = await Promise.all([
    getT(),
    listOrganizations.call({ limit: 100 }, actor),
    listCustomFields.call({ entity: "contact" }, actor),
  ]);
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">
          {t("contacts.new")}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {t("contacts.new.intro")}
        </p>
      </div>
      <ContactForm
        labels={contactFormLabels(t)}
        organizations={organizationResult.rows}
        customFields={customFields}
        values={{
          name: "",
          email: "",
          phone: "",
          orgId: "",
          lifecycleStage: "lead",
          tags: [],
          preferredLocale: "",
          timezone: "",
          country: "",
          customFields: {},
          ownerNotes: "",
        }}
      />
    </div>
  );
}
