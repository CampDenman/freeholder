// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One room of the customer portal (MASTER.md §43 C8.11).
//
// One route for every room, because the rooms are data. A module claims a
// section at import time and it appears here; nothing in this file names
// quotes, invoices or bookings, so C9.13's subscriptions and C9.09's referral
// earnings will arrive without it changing.
//
// That is the same reasoning §32 applies to the public site — "structure is
// data; code is vocabulary" — and it is why a portal with eight rooms is one
// page rather than eight nearly-identical ones that drift.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { formatMoney } from "@/core/i18n";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { myRecords } from "@/core/portal/service";
import { currentBusiness } from "@/core/settings/read";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { getLocale, getT } from "../../../i18n";

export const metadata: Metadata = {
  // A portal is a person's own records and never a search result.
  robots: { index: false, follow: false },
};

export default async function PortalRoom({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const [locale, t, jar, business] = await Promise.all([
    getLocale(),
    getT(),
    cookies(),
    currentBusiness(),
  ]);
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  if (actor.kind !== "user") {
    const signIn = business
      ? localizeCustomerHref("/portal/login", locale, business)
      : "/portal/login";
    redirect(signIn);
  }

  const rooms = await myRecords.call({ section, limit: 100 }, actor);
  const room = rooms[0];
  if (!room) notFound();

  const label = t(`portal.room.${room.key}`);

  return (
    <section className="grid gap-4">
      <h1 className="text-2xl font-semibold text-ink">{label}</h1>
      {room.failed ? (
        // Said out loud rather than shown as an empty room. "We could not load
        // this" and "you have none of these" are different facts, and a
        // customer who is told the second when the first is true stops looking.
        <p className="text-ink-muted">{t("portal.room.failed")}</p>
      ) : room.records.length === 0 ? (
        // Naming the room in the empty state, rather than a bare "nothing
        // here": somebody who followed a link wants to know they arrived.
        <p className="text-ink-muted">{t("portal.room.empty", { room: label })}</p>
      ) : (
        <ul className="grid list-none gap-3 p-0">
          {room.records.map((record) => (
            <li key={record.id} className="border-b border-rule pb-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-ink">
                  {record.href ? (
                    <a href={record.href} className="underline">
                      {record.title}
                    </a>
                  ) : (
                    record.title
                  )}
                </span>
                {typeof record.amountMinor === "number" && record.currency ? (
                  <span className="text-ink">
                    {formatMoney(record.amountMinor, record.currency, locale)}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-ink-muted">
                {record.status ? <span className="me-2">{record.status}</span> : null}
                {record.at ? (
                  <time dateTime={record.at.toISOString()}>
                    {record.at.toLocaleDateString(locale)}
                  </time>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
