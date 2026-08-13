// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { listCustomFields } from "@/core/contacts/custom-fields";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { CustomFieldManager } from "./CustomFieldManager";

export const dynamic = "force-dynamic";

export default async function ContactFieldsPage() {
  const actor = await requireStaffActor("contacts", "manage");
  const [t, definitions] = await Promise.all([
    getT(),
    listCustomFields.call({ includeInactive: true }, actor),
  ]);
  const labels: Record<string, string> = {
    new: t("contacts.fields.new"),
    existing: t("contacts.fields.existing"),
    empty: t("contacts.fields.empty"),
    entity: t("contacts.fields.entity"),
    key: t("contacts.fields.key"),
    keyHint: t("contacts.fields.keyHint"),
    keyPlaceholder: t("contacts.fields.keyPlaceholder"),
    label: t("contacts.fields.label"),
    kind: t("contacts.fields.kind"),
    help: t("contacts.fields.help"),
    options: t("contacts.fields.options"),
    optionsHint: t("contacts.fields.optionsHint"),
    position: t("contacts.fields.position"),
    status: t("contacts.fields.status"),
    active: t("contacts.fields.active"),
    inactive: t("contacts.fields.inactive"),
    add: t("contacts.fields.add"),
    save: t("common.saveChanges"),
    saving: t("common.saving"),
    "entity.contact": t("contacts.fields.entity.contact"),
    "entity.organization": t("contacts.fields.entity.organization"),
    "kind.text": t("contacts.fields.kind.text"),
    "kind.number": t("contacts.fields.kind.number"),
    "kind.boolean": t("contacts.fields.kind.boolean"),
    "kind.date": t("contacts.fields.kind.date"),
    "kind.select": t("contacts.fields.kind.select"),
  };
  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/contacts" className="text-sm text-ink-muted">
          {t("contacts.detail.back")}
        </a>
        <h1 className="mt-2 text-xl font-bold tracking-tight">
          {t("contacts.fields.title")}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{t("contacts.fields.intro")}</p>
      </div>
      <CustomFieldManager definitions={definitions} labels={labels} />
    </div>
  );
}
