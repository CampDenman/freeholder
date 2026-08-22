// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Where somebody lands after moving their own appointment (C6.08).
//
// A moved appointment is a new row with a new link (§4.4), so the page the
// customer was on has genuinely stopped existing. Saying so plainly is better
// than a dead link, and the new link reaches them the same way the first one
// did — in an email, not in a URL they were asked to keep.
import type { Metadata } from "next";
import { getT } from "../../../i18n";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("myBooking.movedTitle"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function MovedPage() {
  const t = await getT();
  return (
    <div className="mx-auto grid max-w-2xl gap-4 p-6">
      <h1 className="text-xl font-bold tracking-tight">{t("myBooking.movedTitle")}</h1>
      <p className="max-w-prose text-sm text-ink-muted">{t("myBooking.movedBody")}</p>
    </div>
  );
}
