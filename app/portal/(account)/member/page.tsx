// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.01: a member keeps their own profile.
import type { Metadata } from "next";
import { myKeys } from "@/core/apikeys/personal";
import { MemberKeys } from "./MemberKeys";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { currentBusiness } from "@/core/settings/read";
import { membershipRules, myMembership } from "@/modules/members/service";
import { viewProfile } from "@/modules/members/graph";
import { profileSections } from "@/modules/members/profile";
import { PROFILE_SECTION_KINDS } from "@/modules/members/profile-kinds";
import { ImageUpload } from "./ImageUpload";
import { MemberPasskeys } from "./MemberPasskeys";
import { twoFactorStatus } from "@/core/auth/two-factor";
import { avatarAction, deleteSectionAction, federationAction, revokeDeviceAction, sectionAction } from "./profile-actions";
import { myDevices } from "@/modules/members/e2ee/service";
import { formatDateTime } from "@/core/i18n";
import { myRemoteFollowers, siteHost } from "@/modules/members/federation/core";
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
  const [me, rules] = await Promise.all([actor.kind === "user" ? myMembership.call({}, actor) : null, membershipRules.call({}, actor)]);
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
  const [mine, sections, security, agentKeys, remote, devices] = await Promise.all([
    viewProfile.call({ handle: me.handle }, actor),
    profileSections.call({ handle: me.handle }, actor),
    twoFactorStatus.call({}, actor),
    myKeys.call({}, actor),
    rules.federation && me.federated ? myRemoteFollowers.call({}, actor) : null,
    me.status === "active" ? myDevices.call({}, actor) : { devices: [] },
  ]);
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
        {rules.adultContent && me.isAdult ? (
          <label className="flex items-start gap-2">
            <input type="checkbox" name="showAdult" value="yes" defaultChecked={me.showAdult} />
            <span>{t("members.adult.showAdult")}</span>
          </label>
        ) : null}
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
          <label className="flex items-start gap-2">
            <input type="checkbox" name="readReceipts" value="yes" defaultChecked={me.readReceipts} />
            <span>{t("members.privacy.readReceipts")}</span>
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
      {rules.federation && me.status === "active" ? (
        <section className="grid gap-3" aria-labelledby="your-fediverse">
          <h2 id="your-fediverse" className="text-xl font-semibold">{t("members.federation.title")}</h2>
          <p className="text-sm text-ink-muted">{t("members.federation.intro")}</p>
          {me.federated ? (
            <p>
              {t("members.federation.address")} <code>@{me.handle}@{siteHost()}</code> · {t("members.federation.followers", { n: remote?.count ?? 0 })}
            </p>
          ) : null}
          <form action={federationAction}>
            <input type="hidden" name="federated" value={me.federated ? "no" : "yes"} />
            <Button type="submit" variant={me.federated ? "quiet" : "primary"}>{t(me.federated ? "members.federation.leave" : "members.federation.join")}</Button>
          </form>
          {me.federated ? <p className="text-sm text-ink-muted">{t("members.federation.leaveNote")}</p> : null}
        </section>
      ) : null}
      <section className="grid gap-3" aria-labelledby="your-passkeys">
        <h2 id="your-passkeys" className="text-xl font-semibold">{t("portal.passkey.manageTitle")}</h2>
        {security.webauthn.length === 0 ? <Callout>{t("portal.passkey.prompt")}</Callout> : null}
        <MemberPasskeys passkeys={security.webauthn.map((p) => ({ id: p.id, name: p.name }))} labels={{
          name: t("portal.passkey.name"),
          defaultName: t("portal.passkey.defaultName"),
          add: t("portal.passkey.add"),
          remove: t("portal.passkey.remove"),
          added: t("portal.passkey.added"),
          failed: t("portal.passkey.failed"),
          none: t("portal.passkey.none"),
          codesIntro: t("portal.passkey.codesIntro"),
          recoveryCode: t("portal.passkey.recoveryCode"),
          useCode: t("portal.passkey.useCode"),
        }} />
        <p className="text-sm text-ink-muted">{t("portal.passkey.recovery")}</p>
      </section>
      <section className="grid gap-3" aria-labelledby="your-devices">
        <h2 id="your-devices" className="text-xl font-semibold">{t("members.e2ee.devicesTitle")}</h2>
        <p className="text-sm text-ink-muted">{t("members.e2ee.devicesIntro")}</p>
        {devices.devices.length === 0 ? <p className="text-sm">{t("members.e2ee.noDevices")}</p> : (
          <ul className="grid gap-2">
            {devices.devices.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-rule p-3">
                <span><strong>{d.label}</strong> · {t("members.e2ee.lastUsed", { when: formatDateTime(d.lastSeenAt, business?.timezone ?? "UTC", locale) })}</span>
                <form action={revokeDeviceAction}><input type="hidden" name="deviceId" value={d.id} /><Button type="submit" variant="quiet">{t("members.e2ee.removeDevice")}</Button></form>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="grid gap-3" aria-labelledby="your-agent">
        <h2 id="your-agent" className="text-xl font-semibold">{t("portal.keys.title")}</h2>
        <p className="text-sm text-ink-muted">{t("portal.keys.intro")}</p>
        <MemberKeys
          endpoint="/api/mcp"
          keys={agentKeys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, expiresAt: k.expiresAt?.toISOString() ?? "" }))}
          labels={{
            name: t("portal.keys.name"), defaultName: t("portal.keys.defaultName"), read: t("portal.keys.read"), post: t("portal.keys.post"),
            message: t("portal.keys.message"), days: t("portal.keys.days"), create: t("portal.keys.create"), shownOnce: t("portal.keys.shownOnce"),
            stop: t("portal.keys.stop"), none: t("portal.keys.none"), expires: t("portal.keys.expires"), failed: t("portal.keys.failed"), endpoint: t("portal.keys.endpoint"),
          }}
        />
      </section>
      <section className="grid gap-3" aria-labelledby="your-avatar">
        <h2 id="your-avatar" className="text-xl font-semibold">{t("members.avatar.title")}</h2>
        {mine?.avatarUrl ? <img src={mine.avatarUrl} alt={t("members.avatar.current")} width={96} height={96} className="h-24 w-24 rounded-full object-cover" /> : null}
        <form action={avatarAction} className="grid gap-2">
          <ImageUpload name="avatar" label={t("members.avatar.choose")} busyLabel={t("members.avatar.uploading")} failedLabel={t("members.avatar.failed")} />
        </form>
        {mine?.avatarUrl ? (
          <form action={avatarAction}><input type="hidden" name="remove" value="yes" /><Button type="submit" variant="quiet">{t("members.avatar.remove")}</Button></form>
        ) : null}
      </section>
      <section className="grid gap-3" aria-labelledby="your-sections">
        <h2 id="your-sections" className="text-xl font-semibold">{t("members.sections.title")}</h2>
        <p className="text-sm text-ink-muted">{t("members.sections.intro")}</p>
        <ul className="grid gap-2">
          {sections.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-rule p-3">
              <span><strong>{s.title}</strong> · {t(`members.sections.kind.${s.kind}`)} · {t(`members.visibility.${s.visibility}`)}</span>
              <form action={deleteSectionAction}><input type="hidden" name="id" value={s.id} /><Button type="submit" variant="quiet">{t("members.sections.remove")}</Button></form>
            </li>
          ))}
        </ul>
        <form action={sectionAction} className="grid gap-3 rounded-md border border-rule p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t("members.sections.kindLabel")} htmlFor="section-kind">
              <Select id="section-kind" name="kind" defaultValue="text">
                {PROFILE_SECTION_KINDS.filter((k) => k !== "pinned").map((k) => <option key={k} value={k}>{t(`members.sections.kind.${k}`)}</option>)}
              </Select>
            </Field>
            <Field label={t("members.sections.titleLabel")} htmlFor="section-title">
              <Input id="section-title" name="title" required maxLength={80} />
            </Field>
            <Field label={t("members.post.visibility")} htmlFor="section-visibility">
              <Select id="section-visibility" name="visibility" defaultValue="public">
                {VISIBILITIES.map((v) => <option key={v} value={v}>{t(`members.visibility.${v}`)}</option>)}
              </Select>
            </Field>
          </div>
          <Field label={t("members.sections.bodyLabel")} htmlFor="section-body">
            <textarea id="section-body" name="body" maxLength={5000} rows={3} className="w-full rounded-md border border-rule-strong bg-field px-3 py-2 text-sm" />
          </Field>
          <ImageUpload name="items" multiple label={t("members.sections.images")} busyLabel={t("members.avatar.uploading")} failedLabel={t("members.avatar.failed")} />
          <input type="hidden" name="position" value={sections.length} />
          <div><Button type="submit">{t("members.sections.add")}</Button></div>
        </form>
      </section>
      <section className="grid gap-2" aria-labelledby="your-data">
        <h2 id="your-data" className="text-xl font-semibold">{t("members.data.title")}</h2>
        <p className="text-sm">{t("members.data.export")}</p>
        <p className="text-sm">{t("members.data.erase")}</p>
        <p className="text-sm text-ink-muted">{t("members.data.noTrackers")}</p>
        <p><a className="underline" href={href("/portal/privacy")}>{t("members.data.manage")}</a></p>
      </section>
    </div>
  );
}
