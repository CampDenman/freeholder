// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// The public assessment's door into the service layer (MASTER.md §4.18, C8.14).
//
// A Server Action for the same reason the form has one: it works before any
// JavaScript loads, and Next verifies the request Origin, so this path carries
// its own CSRF defence.
//
// What is different here is what comes back. A form redirects with a code
// meaning "sent"; an assessment has to redirect with *which outcome*, and the
// outcome is a paragraph. Putting that paragraph in the query string would
// make the page echo attacker-supplied text on a crafted link, so only the
// band's key travels and the block reads the words from the row the owner
// wrote. That keeps the module's promise — the outcome is authored, never
// composed — true across the redirect as well as inside the service.
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getPublicAssessment, respond } from "@/modules/assessments/service";
import type { AssessmentQuestion } from "@/modules/assessments/questions";
import { PATH_HEADER } from "@/core/http/headers";
import { currentBusiness } from "@/core/settings/read";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { getLocale } from "../i18n";

const ANONYMOUS = { kind: "anonymous" } as const;

export async function submitPublicAssessment(form: FormData): Promise<void> {
  const rawSlug = form.get("assessment_slug");
  const slug = typeof rawSlug === "string" ? rawSlug : "";
  const requestHeaders = await headers();
  const barePath = requestHeaders.get(PATH_HEADER) ?? "/";
  const [business, locale] = await Promise.all([currentBusiness(), getLocale()]);
  const path = business ? localizeCustomerHref(barePath, locale, business) : barePath;
  const failed = `${path}?assessmentError=${encodeURIComponent(slug)}`;

  // The question kinds decide the shape of an answer: a `multi` with one box
  // ticked posts a single value, and the validator wants an array. Reading the
  // definition rather than guessing from arity is what keeps those apart.
  const definition = await getPublicAssessment.call({ slug }, ANONYMOUS);
  if (!definition || definition.status !== "active") redirect(failed);

  const questions = definition.questions as AssessmentQuestion[];
  const answers: Record<string, string | string[]> = {};
  for (const question of questions) {
    const raw = form
      .getAll(`q.${question.key}`)
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    if (!raw.length) continue;
    answers[question.key] = question.kind === "multi" ? raw : raw[0]!;
  }

  const rawNonce = form.get("assessment_nonce");
  const idempotencyKey =
    typeof rawNonce === "string" && rawNonce.trim() ? rawNonce.trim() : undefined;

  const rawEmail = form.get("respondent_email");
  const email = typeof rawEmail === "string" && rawEmail.trim() ? rawEmail.trim() : undefined;

  let outcome: Awaited<ReturnType<typeof respond.call>>;
  try {
    outcome = await respond.call(
      {
        slug,
        answers,
        respondent: email ? { email } : undefined,
        idempotencyKey,
        sourceUrl: path,
      },
      ANONYMOUS,
    );
  } catch {
    // Deliberately not distinguishing validation from rate limiting in the
    // redirect: a public surface that reports *why* it refused is also telling
    // a script how to get past it. The owner sees the real reason in the audit
    // log either way.
    redirect(failed);
  }

  const query = new URLSearchParams({
    assessed: slug,
    band: outcome.band.key,
  });
  if (outcome.escalation) query.set("alert", outcome.escalation.id);
  redirect(`${path}?${query.toString()}`);
}
