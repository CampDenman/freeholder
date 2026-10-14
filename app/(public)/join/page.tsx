// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.01 (MASTER.md §44.1): become a member of this site.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { currentBusiness } from "@/core/settings/read";
import { membershipRules, myMembership } from "@/modules/members/service";
import { Button, Callout, Field, Input } from "@/ui/primitives";
import { getLocale, getT } from "../../i18n";
import { joinSiteAction } from "./actions";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("members.join.title") };
}

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [t, locale, business, jar, query] = await Promise.all([getT(), getLocale(), currentBusiness(), cookies(), searchParams]);
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  const href = (path: string) => (business ? localizeCustomerHref(path, locale, business) : path);
  const rules = await membershipRules.call({}, actor);
  if (actor.kind === "user" && (await myMembership.call({}, actor))) redirect(href("/portal/member"));
  const site = business?.name ?? "";
  const errors: Record<string, string> = {
    conflict: t("members.join.error.handle"),
    permission: t(rules.joinPolicy === "invite" ? "members.join.error.invite" : "members.join.error.signIn"),
    validation: t("members.join.error.validation"),
  };
  return (
    <div className="mx-auto grid max-w-xl gap-6 px-6 py-12">
      <h1 className="text-3xl font-semibold">{t("members.join.title")}</h1>
      <p>{t(`members.join.policy.${rules.joinPolicy}`, { site })}</p>
      {query.error ? <Callout tone="danger">{errors[query.error] ?? t("members.join.error.failed")}</Callout> : null}
      {actor.kind !== "user" ? (
        <a className="underline" href={href(`/portal/login?returnTo=${encodeURIComponent("/join")}`)}>
          {t("members.join.signInFirst")}
        </a>
      ) : (
        <form action={joinSiteAction} className="grid gap-4 rounded-lg border border-rule bg-surface p-6">
          <Field label={t("members.field.handle")} htmlFor="handle" hint={t("members.field.handleHint")}>
            <Input id="handle" name="handle" required minLength={3} maxLength={30} pattern="[a-zA-Z0-9_]{3,30}" autoComplete="username" />
          </Field>
          <Field label={t("members.field.displayName")} htmlFor="displayName">
            <Input id="displayName" name="displayName" required maxLength={80} autoComplete="name" />
          </Field>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="meetsMinimumAge" value="yes" required />
            <span>{t("members.field.minimumAge", { age: rules.minimumAge })}</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="isAdult" value="yes" />
            <span>{t("members.field.isAdult")}</span>
          </label>
          <p className="text-sm text-ink-muted">{t("members.join.privacy")}</p>
          <Button type="submit">{t("members.join.submit")}</Button>
        </form>
      )}
    </div>
  );
}
