// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What a mistyped or retired address shows (MASTER.md §5).
//
// There was no not-found route, so Next rendered its bare fallback inside this
// site's layout: a visitor who mistyped a URL, or followed a link to a page the
// owner has since removed, got an empty body under the site's own header.
// Reported by a third party who hit it on a live site.
//
// Deliberately small. A 404 that tries to be a landing page is guessing at what
// somebody wanted; saying plainly that the address is wrong and offering the
// way back is the honest answer, and the one that does not waste their time.
import Link from "next/link";
import { getT } from "./i18n";

export default async function NotFound() {
  const t = await getT();
  return (
    <main className="mx-auto grid max-w-prose gap-4 px-[var(--fh-gutter,1.5rem)] py-16">
      <h1 className="text-2xl font-semibold text-ink">{t("notFound.title")}</h1>
      <p className="text-ink-muted">{t("notFound.body")}</p>
      <p>
        <Link href="/" className="font-semibold text-accent underline">
          {t("notFound.home")}
        </Link>
      </p>
    </main>
  );
}
