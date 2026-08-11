// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Deliberate entry by a human. Automated paths use contacts.resolve instead,
// so a form submission never mints a second record for somebody already known.
import { getT } from "../../../../i18n";
import { contactFormLabels } from "../contactLabels";
import { ContactForm } from "../ContactForm";
import { requireStaffActor } from "../../guard";

export const dynamic = "force-dynamic";

export default async function NewContactPage() {
  await requireStaffActor("contacts", "manage");
  const t = await getT();
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
        values={{
          name: "",
          email: "",
          phone: "",
          lifecycleStage: "lead",
          tags: [],
          ownerNotes: "",
        }}
      />
    </div>
  );
}
