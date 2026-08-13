// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Translate } from "@/core/i18n";

export function organizationLabels(t: Translate): Record<string, string> {
  return {
    details: t("contacts.organizations.details"),
    new: t("contacts.organizations.new"),
    name: t("contacts.organizations.name"),
    domain: t("contacts.organizations.domain"),
    domainHint: t("contacts.organizations.domainHint"),
    domainPlaceholder: t("contacts.organizations.domainPlaceholder"),
    customFields: t("contacts.fields.valuesTitle"),
    customFieldsIntro: t("contacts.fields.organizationValuesIntro"),
    saved: t("common.saved"),
    saving: t("common.saving"),
    save: t("common.saveChanges"),
    add: t("contacts.organizations.add"),
    cancel: t("common.cancel"),
    delete: t("common.delete"),
    deleteHint: t("contacts.organizations.deleteHint"),
    empty: t("common.emptyValue"),
    yes: t("common.yes"),
    no: t("common.no"),
  };
}
