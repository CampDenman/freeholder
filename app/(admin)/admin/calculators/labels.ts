// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Copy for the calculator builder, resolved on the server (§15.3).
import type { Translate } from "@/core/i18n";
import type { CalculatorBuilderLabels } from "./CalculatorBuilder";

export function calculatorLabels(t: Translate, isNew: boolean): CalculatorBuilderLabels {
  return {
    aboutTitle: isNew ? t("calculators.builder.newTitle") : t("calculators.builder.title"),
    name: t("calculators.field.name"),
    slug: t("calculators.field.slug"),
    slugHint: t("calculators.field.slugHint"),
    intro: t("calculators.field.intro"),
    resultLabel: t("calculators.field.resultLabel"),
    resultLabelHint: t("calculators.field.resultLabelHint"),
    resultUnit: t("calculators.field.resultUnit"),
    assumptions: t("calculators.field.assumptions"),
    assumptionsHint: t("calculators.field.assumptionsHint"),
    askTitle: t("calculators.ask.title"),
    noInputs: t("calculators.ask.empty"),
    inputLabel: t("calculators.ask.label"),
    key: t("calculators.field.key"),
    unit: t("calculators.ask.unit"),
    min: t("calculators.ask.min"),
    max: t("calculators.ask.max"),
    addInput: t("calculators.ask.add"),
    removeInput: t("calculators.ask.remove"),
    stepsTitle: t("calculators.steps.title"),
    noSteps: t("calculators.steps.empty"),
    step: t("calculators.steps.step"),
    stepLabel: t("calculators.steps.label"),
    operation: t("calculators.steps.operation"),
    left: t("calculators.steps.left"),
    right: t("calculators.steps.right"),
    termKind: t("calculators.term.kind"),
    termLiteral: t("calculators.term.literal"),
    termInput: t("calculators.term.input"),
    termFact: t("calculators.term.fact"),
    termStep: t("calculators.term.step"),
    termValue: t("calculators.term.value"),
    termFactExample: t("calculators.term.factExample"),
    addStep: t("calculators.steps.add"),
    removeStep: t("calculators.steps.remove"),
    moveUp: t("calculators.steps.moveUp"),
    moveDown: t("calculators.steps.moveDown"),
    problems: t("calculators.problems"),
    save: t("calculators.save"),
    saving: t("calculators.saving"),
    saved: t("calculators.saved"),
  };
}
