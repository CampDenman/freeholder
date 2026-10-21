// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Copy for the published-fact forms, resolved on the server (§15.3).
import type { Translate } from "@/core/i18n";
import type { FactFormLabels } from "./FactForms";

export function factFormLabels(t: Translate): FactFormLabels {
  return {
    recordTitle: t("facts.record.title"),
    correctTitle: t("facts.correct.title"),
    key: t("facts.field.key"),
    keyHint: t("facts.field.keyHint"),
    value: t("facts.field.value"),
    valueHint: t("facts.field.valueHint"),
    source: t("facts.field.source"),
    sourceHint: t("facts.field.sourceHint"),
    asOf: t("facts.field.asOf"),
    asOfHint: t("facts.field.asOfHint"),
    validUntil: t("facts.field.validUntil"),
    validUntilHint: t("facts.field.validUntilHint"),
    subjectKind: t("facts.field.subjectKind"),
    subjectId: t("facts.field.subjectId"),
    subjectHint: t("facts.field.subjectHint"),
    note: t("facts.field.note"),
    noteHint: t("facts.field.noteHint"),
    record: t("facts.record.submit"),
    correct: t("facts.correct.submit"),
    withdraw: t("facts.withdraw.submit"),
    withdrawReason: t("facts.withdraw.reason"),
    saved: t("facts.saved"),
  };
}
