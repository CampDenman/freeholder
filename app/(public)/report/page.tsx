// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.12 (MASTER.md §44.9): report anything on the site.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { REPORT_REASONS, REPORT_TARGETS } from "@/modules/members/report-kinds";
import { Button, Callout, Field, Select } from "@/ui/primitives";
import { getT } from "../../i18n";
import { reportAction } from "./actions";

export const dynamic = "force-dynamic";
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ type?: string }> }): Promise<Metadata> {
  const [{ type }, t] = await Promise.all([searchParams, getT()]);
  const known = (REPORT_TARGETS as readonly string[]).includes(type ?? "");
  return { title: t(known ? `members.report.title.${type}` : "members.report.action"), robots: { index: false, follow: false } };
}

export default async function ReportPage({ searchParams }: { searchParams: Promise<{ type?: string; id?: string; sent?: string; error?: string }> }) {
  const [query, t, jar] = await Promise.all([searchParams, getT(), cookies()]);
  const type = query.type ?? "";
  if (!(REPORT_TARGETS as readonly string[]).includes(type) || !/^[0-9a-f-]{36}$/.test(query.id ?? "")) notFound();
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  return (
    <div className="mx-auto grid max-w-xl gap-6 px-6 py-12">
      <h1 className="text-2xl font-semibold">{t(`members.report.title.${type}`)}</h1>
      {query.sent ? (
        <Callout tone="success">{t("members.report.sent")}</Callout>
      ) : actor.kind !== "user" ? (
        <p><a className="underline" href="/join">{t("members.report.signIn")}</a></p>
      ) : (
        <>
          {query.error ? <Callout tone="danger">{t(query.error === "not_found" ? "members.report.gone" : "members.report.failed")}</Callout> : null}
          <p className="text-ink-muted">{t("members.report.intro")}</p>
          {type === "listing" ? <p className="text-sm"><a className="underline" href="/market/policy">{t("members.policy.link")}</a></p> : null}
          <form action={reportAction} className="grid gap-4">
            <input type="hidden" name="type" value={type} />
            <input type="hidden" name="id" value={query.id} />
            <Field label={t("members.report.reason")} htmlFor="reason">
              <Select id="reason" name="reason">
                {REPORT_REASONS.map((r) => <option key={r} value={r}>{t(`members.report.reasons.${r}`)}</option>)}
              </Select>
            </Field>
            <Field label={t("members.report.details")} htmlFor="details">
              <textarea id="details" name="details" maxLength={2000} rows={4} className="w-full rounded-md border border-rule-strong bg-field px-3 py-2 text-sm" />
            </Field>
            <p className="text-sm text-ink-muted">{t("members.report.emergency")}</p>
            <div><Button type="submit" variant="danger">{t("members.report.send")}</Button></div>
          </form>
        </>
      )}
    </div>
  );
}
