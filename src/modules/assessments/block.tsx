// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The assessment block (MASTER.md §4.18, §11, §32, C8.14).
//
// Server-rendered with no client component, like the form block it sits beside
// (§5 and the SEO gate both rest on that). The outcome therefore cannot travel
// back in the URL as text — the action doctrine is that only a *code* goes in
// a query string, because a page that echoes arbitrary text from its own query
// string is a phishing page waiting for a crafted link.
//
// So the redirect carries the band's key, and the body is read from the row the
// owner wrote. Round-tripping a key rather than a sentence is also the same
// guarantee the rest of the module makes, enforced one layer further out:
// there is no path by which text a visitor controls becomes the outcome.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { defineBlock } from "@/modules/cms/blocks/types";
import { submitPublicAssessment } from "../../../app/(public)/assessment-actions";
import type { AssessmentQuestion } from "./questions";
import type { Translate } from "@/core/i18n";

export interface ResolvedAssessment {
  slug: string;
  name: string;
  intro: string | null;
  questions: AssessmentQuestion[];
  bands: Array<{ key: string; label: string; body: string }>;
  escalations: Array<{ id: string; instruction: string }>;
  /**
   * Issued per render, and posted back with the answers.
   *
   * A double-click or a back button posts the same nonce, so the service
   * resolves it to the answer already stored instead of telling somebody the
   * same judgement twice as though it were two.
   */
  nonce: string;
}

export const assessmentBlock = defineBlock({
  type: "assessment",
  labelKey: "cms.block.assessment",
  contexts: ["page"],
  schema: z.object({
    /** The assessment's slug, so renaming its *name* never breaks a page. */
    assessmentSlug: z.string().min(1),
  }),
  // A plausible slug rather than an empty string: the schema requires one, and
  // the editor palette validates every starter it offers. The form block sets
  // "contact" for the same reason.
  starter: () => ({ assessmentSlug: "assessment" }),
  resolve: async (props): Promise<ResolvedAssessment | null> => {
    // Lazy, so the block library does not drag this module into every bundle
    // that only needs a heading.
    const { getPublicAssessment } = await import("./service");
    const found = await getPublicAssessment.call(
      { slug: props.assessmentSlug },
      { kind: "anonymous" },
    );
    if (!found || found.status !== "active") return null;
    return {
      slug: found.slug,
      name: found.name,
      intro: found.intro,
      questions: found.questions as AssessmentQuestion[],
      bands: found.bands,
      escalations: found.escalations,
      nonce: randomUUID(),
    };
  },
  render: ({ resolved, ctx }) => {
    // A block pointing at a draft, closed or deleted assessment renders
    // nothing. A page must not break because a questionnaire was retired.
    if (!resolved) return null;

    if (ctx.query?.assessed === resolved.slug) {
      const band = resolved.bands.find((candidate) => candidate.key === ctx.query?.band);
      const escalation = resolved.escalations.find(
        (candidate) => candidate.id === ctx.query?.alert,
      );
      // An unknown key means a hand-edited URL. Say nothing rather than
      // guessing which outcome was meant.
      if (!band) return null;
      return (
        <section className="grid max-w-prose gap-4" aria-labelledby={`${resolved.slug}-outcome`}>
          {escalation ? (
            <p
              role="alert"
              className="rounded-md border border-rule bg-danger-soft px-4 py-3 text-sm font-medium text-danger"
            >
              {escalation.instruction}
            </p>
          ) : null}
          <h3 id={`${resolved.slug}-outcome`} className="text-lg font-medium text-ink">
            {band.label}
          </h3>
          {/* The owner's words, rendered as written. Nothing composes this. */}
          <p className="whitespace-pre-line text-sm text-ink-muted">{band.body}</p>
        </section>
      );
    }

    return (
      <RenderedAssessment
        assessment={resolved}
        failed={ctx.query?.assessmentError === resolved.slug}
        t={ctx.t}
      />
    );
  },
});

/** One assessment, rendered as a plain form that works without JavaScript. */
export function RenderedAssessment({
  assessment,
  failed,
  t,
}: {
  assessment: ResolvedAssessment;
  failed: boolean;
  t: Translate;
}) {
  return (
    <form action={submitPublicAssessment} className="grid max-w-prose gap-6">
      <input type="hidden" name="assessment_slug" value={assessment.slug} />
      <input type="hidden" name="assessment_nonce" value={assessment.nonce} />

      {assessment.intro ? (
        <p className="whitespace-pre-line text-sm text-ink-muted">{assessment.intro}</p>
      ) : null}

      {failed ? (
        <p
          role="alert"
          className="rounded-md border border-rule bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          {t("assessments.public.error")}
        </p>
      ) : null}

      {assessment.questions.map((question) => (
        <fieldset key={question.key} className="grid gap-2 border-0 p-0">
          <legend className="text-sm font-medium text-ink">
            {question.label}
            {question.required ? (
              <span aria-hidden="true" className="text-danger">
                {" *"}
              </span>
            ) : null}
          </legend>
          {question.help ? (
            <p id={`${question.key}-help`} className="text-xs text-ink-muted">
              {question.help}
            </p>
          ) : null}
          <div className="grid gap-1">
            {question.options.map((option) => (
              <label
                key={option.key}
                className="flex items-start gap-2 text-sm text-ink"
                htmlFor={`${question.key}-${option.key}`}
              >
                <input
                  id={`${question.key}-${option.key}`}
                  type={question.kind === "multi" ? "checkbox" : "radio"}
                  name={`q.${question.key}`}
                  value={option.key}
                  required={question.required && question.kind !== "multi"}
                  aria-describedby={question.help ? `${question.key}-help` : undefined}
                  className="mt-1"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      <div className="grid gap-2">
        <label htmlFor={`${assessment.slug}-email`} className="text-sm font-medium text-ink">
          {t("assessments.public.email")}
        </label>
        <input
          id={`${assessment.slug}-email`}
          type="email"
          name="respondent_email"
          autoComplete="email"
          className="rounded-md border border-rule-strong bg-surface px-3 py-2 text-sm text-ink"
        />
        <p className="text-xs text-ink-muted">{t("assessments.public.emailHelp")}</p>
      </div>

      <button
        type="submit"
        className="justify-self-start rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent"
      >
        {t("assessments.public.submit")}
      </button>
    </form>
  );
}
