// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.01: a member keeps their own profile.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { currentBusiness } from "@/core/settings/read";
import { myMembership } from "@/modules/members/service";
import { Button, Callout, Field, Input, Pill, Select } from "@/ui/primitives";
import { VISIBILITIES } from "@/modules/members/visibility";
import { getLocale, getT } from "../../../i18n";
import { updateMemberProfileAction } from "../../../(public)/join/actions";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("members.profile.title"), robots: { index: false, follow: false } };
}

export default async function MemberProfilePage({ searchParams }: { searchParams: Promise<{ saved?: string; joined?: string; error?: string }> }) {
  const [t, locale, business, jar, query] = await Promise.all([getT(), getLocale(), currentBusiness(), cookies(), searchParams]);
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  const me = actor.kind === "user" ? await myMembership.call({}, actor) : null;
  const href = (path: string) => (business ? localizeCustomerHref(path, locale, business) : path);
  if (!me) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">{t("members.profile.title")}</h1>
        <p>{t("members.profile.notMember")}</p>
        <a className="underline" href={href("/join")}>{t("members.join.title")}</a>
      </div>
    );
  }
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">{t("members.profile.title")}</h1>
      <p className="flex items-center gap-2">
        <a className="underline" href={`/@${me.handle}`}>@{me.handle}</a>
        <Pill>{t(`members.status.${me.status}`)}</Pill>
      </p>
      {me.status === "pending" ? <Callout>{t("members.profile.pending")}</Callout> : null}
      {me.status === "suspended" ? <Callout tone="danger">{t("members.profile.suspended")}</Callout> : null}
      {query.joined ? <Callout tone="success">{t("members.profile.joined")}</Callout> : null}
      {query.saved ? <Callout tone="success">{t("members.profile.saved")}</Callout> : null}
      {query.error ? <Callout tone="danger">{t(query.error === "conflict" ? "members.profile.error.handle" : "members.join.error.failed")}</Callout> : null}
      <form action={updateMemberProfileAction} className="grid gap-4 rounded-lg border border-rule bg-surface p-6">
        <Field label={t("members.field.displayName")} htmlFor="displayName">
          <Input id="displayName" name="displayName" required maxLength={80} defaultValue={me.displayName} />
        </Field>
        <Field label={t("members.field.handle")} htmlFor="handle" hint={t("members.profile.handleHint")}>
          <Input id="handle" name="handle" required minLength={3} maxLength={30} pattern="[a-zA-Z0-9_]{3,30}" defaultValue={me.handle} />
        </Field>
        <Field label={t("members.field.bio")} htmlFor="bio">
          <textarea id="bio" name="bio" maxLength={1000} rows={4} defaultValue={me.bio} className="w-full rounded-md border border-rule-strong bg-field px-3 py-2 text-sm" />
        </Field>
        <fieldset className="grid gap-2">
          <legend className="font-medium">{t("members.field.links")}</legend>
          {[0, 1, 2].map((i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-2">
              <Field label={t("members.field.linkLabel", { n: i + 1 })} htmlFor={`linkLabel${i}`}>
                <Input id={`linkLabel${i}`} name={`linkLabel${i}`} maxLength={40} defaultValue={me.links[i]?.label ?? ""} />
              </Field>
              <Field label={t("members.field.linkUrl", { n: i + 1 })} htmlFor={`linkUrl${i}`}>
                <Input id={`linkUrl${i}`} name={`linkUrl${i}`} type="url" maxLength={500} defaultValue={me.links[i]?.url ?? ""} />
              </Field>
            </div>
          ))}
        </fieldset>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="isAdult" value="yes" defaultChecked={me.isAdult} />
          <span>{t("members.field.isAdult")}</span>
        </label>
        <fieldset className="grid gap-3">
          <legend className="font-medium">{t("members.privacy.title")}</legend>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="isPrivate" value="yes" defaultChecked={me.isPrivate} />
            <span>{t("members.privacy.isPrivate")}</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="indexable" value="yes" defaultChecked={me.indexable} />
            <span>{t("members.privacy.indexable")}</span>
          </label>
          {(["bioVisibility", "linksVisibility", "defaultPostVisibility"] as const).map((key) => (
            <Field key={key} label={t(`members.privacy.${key}`)} htmlFor={key}>
              <Select id={key} name={key} defaultValue={me[key]}>
                {VISIBILITIES.map((v) => <option key={v} value={v}>{t(`members.visibility.${v}`)}</option>)}
              </Select>
            </Field>
          ))}
        </fieldset>
        <Button type="submit">{t("members.profile.save")}</Button>
      </form>
    </div>
  );
}
