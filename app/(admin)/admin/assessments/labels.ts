// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Copy for the assessment editors, resolved on the server (§15.3).
//
// The client components take a plain label bag rather than calling `t`
// themselves, so the translation layer stays on the server and a builder never
// ships a catalogue to the browser.
import type { Translate } from "@/core/i18n";
import type { QuestionLabels } from "./QuestionBuilder";
import type { BandLabels } from "./BandEditor";
import type { EscalationLabels } from "./EscalationEditor";
import type { PublishLabels } from "./PublishControls";

export function questionLabels(t: Translate, isNew: boolean): QuestionLabels {
  return {
    aboutTitle: isNew ? t("assessments.builder.newTitle") : t("assessments.builder.title"),
    name: t("assessments.builder.name"),
    slug: t("assessments.builder.slug"),
    slugHint: t("assessments.builder.slugHint"),
    intro: t("assessments.builder.intro"),
    introHint: t("assessments.builder.introHint"),
    destination: t("assessments.builder.destination"),
    destinationContact: t("assessments.builder.destinationContact"),
    destinationNone: t("assessments.builder.destinationNone"),
    destinationHint: t("assessments.builder.destinationHint"),
    notify: t("assessments.builder.notify"),
    notifyHint: t("assessments.builder.notifyHint"),
    questionsTitle: t("assessments.builder.questions"),
    noQuestions: t("assessments.builder.noQuestions"),
    question: t("assessments.builder.question"),
    questionLabel: t("assessments.builder.questionLabel"),
    key: t("assessments.builder.key"),
    keyHint: t("assessments.builder.keyHint"),
    kind: t("assessments.builder.kind"),
    kindHint: t("assessments.builder.kindHint"),
    kindSingle: t("assessments.builder.kindSingle"),
    kindMulti: t("assessments.builder.kindMulti"),
    kindScale: t("assessments.builder.kindScale"),
    help: t("assessments.builder.help"),
    helpHint: t("assessments.builder.helpHint"),
    required: t("assessments.builder.required"),
    answers: t("assessments.builder.answers"),
    answerLabel: t("assessments.builder.answerLabel"),
    score: t("assessments.builder.score"),
    addAnswer: t("assessments.builder.addAnswer"),
    removeAnswer: t("assessments.builder.removeAnswer"),
    twoAnswers: t("assessments.builder.twoAnswers"),
    addQuestion: t("assessments.builder.addQuestion"),
    removeQuestion: t("assessments.builder.removeQuestion"),
    moveUp: t("assessments.builder.moveUp"),
    moveDown: t("assessments.builder.moveDown"),
    reachable: t("assessments.builder.reachable"),
    save: t("assessments.builder.save"),
    saving: t("assessments.builder.saving"),
    saved: t("assessments.builder.saved"),
  };
}

export function bandLabels(t: Translate): BandLabels {
  return {
    title: t("assessments.bands.title"),
    intro: t("assessments.bands.intro"),
    empty: t("assessments.bands.empty"),
    label: t("assessments.bands.label"),
    key: t("assessments.bands.key"),
    keyHint: t("assessments.bands.keyHint"),
    min: t("assessments.bands.min"),
    max: t("assessments.bands.max"),
    body: t("assessments.bands.body"),
    bodyHint: t("assessments.bands.bodyHint"),
    add: t("assessments.bands.add"),
    save: t("assessments.bands.save"),
    cancel: t("assessments.bands.cancel"),
    remove: t("assessments.bands.remove"),
    covered: t("assessments.bands.covered"),
    coveredDetail: t("assessments.bands.coveredDetail"),
    gaps: t("assessments.bands.gaps"),
    gapsDetail: t("assessments.bands.gapsDetail"),
  };
}

export function escalationLabels(t: Translate): EscalationLabels {
  return {
    title: t("assessments.escalations.title"),
    intro: t("assessments.escalations.intro"),
    empty: t("assessments.escalations.empty"),
    question: t("assessments.escalations.question"),
    answer: t("assessments.escalations.answer"),
    instruction: t("assessments.escalations.instruction"),
    instructionHint: t("assessments.escalations.instructionHint"),
    add: t("assessments.escalations.add"),
    save: t("assessments.escalations.save"),
    cancel: t("assessments.escalations.cancel"),
    remove: t("assessments.escalations.remove"),
    orphaned: t("assessments.escalations.orphaned"),
    needQuestions: t("assessments.escalations.needQuestions"),
  };
}

export function publishLabels(t: Translate): PublishLabels {
  return {
    publish: t("assessments.publish"),
    reopen: t("assessments.reopen"),
    close: t("assessments.close"),
  };
}
