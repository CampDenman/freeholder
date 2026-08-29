// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The customer's own details, password and devices (MASTER.md §4.1, C8.10).
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Button, Card, CardBody, CardHeader } from "@/ui/primitives";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { myProfile } from "@/core/portal/service";
import { listSessions } from "@/core/auth/session-management/service";
import { currentBusiness } from "@/core/settings/read";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { getLocale, getT } from "../../i18n";
import { revokePortalSessionAction, updatePortalProfileAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function PortalProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const [business, locale, t, jar, query] = await Promise.all([
    currentBusiness(),
    getLocale(),
    getT(),
    cookies(),
    searchParams,
  ]);
  const href = (path: string) =>
    business ? localizeCustomerHref(path, locale, business) : path;
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  if (actor.kind !== "user") redirect(href("/portal/login"));

  const profile = await myProfile.call({}, actor).catch(() => null);
  if (!profile) redirect(href("/portal"));
  const sessions = await listSessions.call({}, actor).catch(() => []);

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("portal.nav.profile")}</h1>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("portal.profile.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {t("portal.profile.failed")}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("portal.profile.details")} />
        <CardBody>
          <form action={updatePortalProfileAction} className="grid gap-3">
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("portal.profile.name")}</span>
              <input
                name="name"
                defaultValue={profile.name}
                required
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("portal.profile.phone")}</span>
              <input
                name="phone"
                defaultValue={profile.phone ?? ""}
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            {/*
              Email is the spine's identity (§4.1). Shown, never editable here:
              changing it would silently fork or merge two people's histories,
              which is the owner's decision through a merge, not a text field.
            */}
            <p className="text-sm text-ink-muted">
              {t("portal.profile.email")}: {profile.email}
            </p>
            <div>
              <Button type="submit">{t("portal.profile.save")}</Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("portal.password.title")} />
        <CardBody>
          <p className="text-sm text-ink-muted">
            {profile.hasPassword
              ? t("portal.password.has")
              : t("portal.password.none")}
          </p>
          <p className="mt-2 text-sm">
            <a href={href("/reset")} className="underline">
              {profile.hasPassword
                ? t("portal.password.change")
                : t("portal.password.set")}
            </a>
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("portal.sessions.title")} />
        <CardBody>
          {sessions.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("portal.sessions.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {sessions.map((session) => (
                <li
                  key={session.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                >
                  <span>{session.deviceLabel}</span>
                  {session.current ? (
                    <span className="text-ink-muted">{t("portal.sessions.current")}</span>
                  ) : (
                    <form action={revokePortalSessionAction}>
                      <input type="hidden" name="id" value={session.id} />
                      <Button type="submit" variant="quiet">
                        {t("portal.sessions.revoke")}
                      </Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
