// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The portal home (MASTER.md §4.1, C8.10).
//
// A short list of doors, and C8.11 filled them: each room a module claimed
// appears below with what is in it, and nothing here names a domain. The
// original note read as follows, and is kept because it explains the shape:
// Deliberately a short list of doors rather than a dashboard. C8.11 fills the
// rooms — quotes, invoices, bookings, galleries, orders — and until it does,
// promising them here would be a menu of dead ends.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/ui/primitives";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { myProfile, myRecords } from "@/core/portal/service";
import { currentBusiness } from "@/core/settings/read";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { getLocale, getT } from "../../i18n";
import { PortalLocaleChooser } from "../PortalLocaleChooser";

export const dynamic = "force-dynamic";

export default async function PortalHomePage() {
  const [business, locale, t, jar] = await Promise.all([
    currentBusiness(),
    getLocale(),
    getT(),
    cookies(),
  ]);
  const policy = {
    defaultLocale: business?.defaultLocale ?? "en",
    enabledLocales: business?.enabledLocales ?? ["en"],
  };
  const href = (path: string) =>
    business ? localizeCustomerHref(path, locale, business) : path;
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  if (actor.kind !== "user") redirect(href("/portal/login"));

  // A staff account signing in here has no contact row, and that is not an
  // error worth a stack trace — it is simply not their portal.
  const profile = await myProfile.call({}, actor).catch(() => null);
  // Ten of each is a door, not a dashboard: enough to recognise the room is
  // worth opening, not so much that the page becomes the room.
  const rooms = profile
    ? await myRecords.call({ limit: 10 }, actor).catch(() => [])
    : [];
  const occupied = rooms.filter((room) => room.count > 0);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {profile ? t("portal.greeting", { name: profile.name }) : t("portal.title")}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{t("portal.intro")}</p>
      </div>

      {profile ? (
        <Card>
          <CardHeader title={t("portal.nav.profile")} />
          <CardBody>
            <p className="text-sm text-ink-muted">{profile.email}</p>
            <p className="mt-2 text-sm">
              <a href={href("/portal/profile")} className="underline">
                {t("portal.profile.manage")}
              </a>
            </p>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-muted">{t("portal.noCustomerRecord")}</p>
          </CardBody>
        </Card>
      )}

      {occupied.length > 0 ? (
        <Card>
          <CardHeader title={t("portal.rooms")} />
          <CardBody>
            <ul className="grid list-none gap-2 p-0">
              {occupied.map((room) => (
                <li key={room.key}>
                  <a href={href(`/portal/${room.key}`)} className="underline">
                    {t(`portal.room.${room.key}`)}
                  </a>
                  <span className="ms-2 text-sm text-ink-muted">{room.count}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t("portal.language")} />
        <CardBody>
          <PortalLocaleChooser
            locale={locale}
            policy={policy}
            path="/portal"
            signedIn
            t={t}
          />
        </CardBody>
      </Card>
    </div>
  );
}
