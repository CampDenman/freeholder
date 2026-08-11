// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The contact form's strings, translated once and passed into the client
// component that renders them (MASTER.md §4.9). Shared by the create and edit
// screens, which are the same form with a different verb on the button.
import type { Translate } from "@/core/i18n";

export const CONTACT_STAGES = [
  "lead",
  "prospect",
  "customer",
  "repeat",
] as const;

export interface ContactFormLabels {
  details: string;
  newContact: string;
  name: string;
  email: string;
  emailHint: string;
  phone: string;
  organization: string;
  noOrganization: string;
  stage: string;
  tags: string;
  tagsHint: string;
  notes: string;
  notesHint: string;
  preferredLocale: string;
  preferredLocaleHint: string;
  preferredLocalePlaceholder: string;
  timezone: string;
  timezoneHint: string;
  timezonePlaceholder: string;
  country: string;
  countryHint: string;
  countryPlaceholder: string;
  customFields: string;
  customFieldsIntro: string;
  emptyValue: string;
  yes: string;
  no: string;
  saved: string;
  saving: string;
  saveChanges: string;
  add: string;
  cancel: string;
  stages: Array<{ value: string; label: string }>;
}

export function contactFormLabels(t: Translate): ContactFormLabels {
  return {
    details: t("contacts.detail.details"),
    newContact: t("contacts.new"),
    name: t("contacts.field.name"),
    email: t("contacts.field.email"),
    emailHint: t("contacts.field.emailHint"),
    phone: t("contacts.field.phone"),
    organization: t("contacts.field.organization"),
    noOrganization: t("contacts.field.noOrganization"),
    stage: t("contacts.field.stage"),
    tags: t("contacts.field.tags"),
    tagsHint: t("contacts.field.tagsHint"),
    notes: t("contacts.field.notes"),
    notesHint: t("contacts.field.notesHint"),
    preferredLocale: t("contacts.field.preferredLocale"),
    preferredLocaleHint: t("contacts.field.preferredLocaleHint"),
    preferredLocalePlaceholder: t("contacts.field.preferredLocalePlaceholder"),
    timezone: t("contacts.field.timezone"),
    timezoneHint: t("contacts.field.timezoneHint"),
    timezonePlaceholder: t("contacts.field.timezonePlaceholder"),
    country: t("contacts.field.country"),
    countryHint: t("contacts.field.countryHint"),
    countryPlaceholder: t("contacts.field.countryPlaceholder"),
    customFields: t("contacts.fields.valuesTitle"),
    customFieldsIntro: t("contacts.fields.valuesIntro"),
    emptyValue: t("common.emptyValue"),
    yes: t("common.yes"),
    no: t("common.no"),
    saved: t("common.saved"),
    saving: t("common.saving"),
    saveChanges: t("common.saveChanges"),
    add: t("contacts.add"),
    cancel: t("common.cancel"),
    stages: CONTACT_STAGES.map((value) => ({
      value,
      label: t(`contacts.stage.${value}`),
    })),
  };
}

export interface MergePanelLabels {
  title: string;
  intro: string;
  searchLabel: string;
  searchPlaceholder: string;
  search: string;
  noEmail: string;
  submit: string;
}

export function mergePanelLabels(t: Translate): MergePanelLabels {
  return {
    title: t("contacts.merge.title"),
    intro: t("contacts.merge.intro"),
    searchLabel: t("contacts.merge.searchLabel"),
    searchPlaceholder: t("contacts.merge.searchPlaceholder"),
    search: t("common.search"),
    noEmail: t("contacts.merge.noEmail"),
    submit: t("contacts.merge.submit"),
  };
}
