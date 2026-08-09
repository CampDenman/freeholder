// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Copy for the form builder, resolved on the server (§15.3).
import type { Translate } from "@/core/i18n";
import { FIELD_KINDS } from "@/modules/forms/fields";
import type { BuilderLabels, KindOption } from "./FieldBuilder";

export function builderLabels(t: Translate, isNew: boolean): BuilderLabels {
  return {
    cardTitle: isNew ? t("forms.builder.newTitle") : t("forms.builder.title"),
    intro: t("forms.builder.intro"),
    name: t("forms.builder.name"),
    slug: t("forms.builder.slug"),
    slugHint: isNew ? t("forms.builder.slugHint") : t("forms.builder.slugLocked"),
    submitLabel: t("forms.builder.submitLabel"),
    successMessage: t("forms.builder.successMessage"),
    successHint: t("forms.builder.successHint"),
    destination: t("forms.builder.destination"),
    destinationContact: t("forms.builder.destinationContact"),
    destinationNone: t("forms.builder.destinationNone"),
    destinationHint: t("forms.builder.destinationHint"),
    notify: t("forms.builder.notify"),
    notifyHint: t("forms.builder.notifyHint"),
    status: t("forms.builder.status"),
    active: t("forms.builder.active"),
    closed: t("forms.builder.closed"),
    questions: t("forms.builder.questions"),
    questionsEmpty: t("forms.builder.questionsEmpty"),
    addQuestion: t("forms.builder.addQuestion"),
    label: t("forms.builder.label"),
    kind: t("forms.builder.kind"),
    required: t("forms.builder.required"),
    placeholder: t("forms.builder.placeholder"),
    help: t("forms.builder.help"),
    options: t("forms.builder.options"),
    optionsHint: t("forms.builder.optionsHint"),
    storedAs: t("forms.builder.storedAs"),
    storedAsHint: t("forms.builder.storedAsHint"),
    storedAsLocked: t("forms.builder.storedAsLocked"),
    moveUp: t("forms.builder.moveUp"),
    moveDown: t("forms.builder.moveDown"),
    remove: t("forms.builder.remove"),
    save: t("common.saveChanges"),
    pending: t("common.saving"),
    saved: t("admin.settings.saved"),
  };
}

/** The field kinds, named for a person rather than by their identifier. */
export function kindOptions(t: Translate): KindOption[] {
  return FIELD_KINDS.map((kind) => ({
    value: kind,
    label: t(`forms.kind.${kind}`),
  }));
}
