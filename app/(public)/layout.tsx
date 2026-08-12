// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The public shell (MASTER.md §32).
//
// Read what this file does *not* contain: no header markup, no nav, no footer,
// no site structure of any kind. §32 requires exactly that — "the header,
// footer, nav and announcement bar are synced Sections … `app/(public)/
// layout.tsx` is a thin shell that renders the chrome Sections; it contains no
// hardcoded site structure. Menus are rows, not JSX."
//
// So this fetches two rows and renders their block trees. Changing the site's
// header is an UPDATE, live on the next request, with a revision kept — and
// nobody has to touch this file to do it.
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { PATH_HEADER } from "@/core/http/headers";
import { renderBlocks } from "@/modules/cms/render";
import { FOOTER_KEY, HEADER_KEY } from "@/modules/cms/defaults";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { getLocale, getT } from "../i18n";
import { currentBusiness } from "@/core/settings/read";
import { publishedSection } from "@/modules/cms/read";
import { localizeCustomerHref } from "@/core/i18n/customer";

export const dynamic = "force-dynamic";


export default async function PublicLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [locale, t, business, requestHeaders] = await Promise.all([
    getLocale(),
    getT(),
    currentBusiness(),
    headers(),
  ]);

  const [header, footer] = await Promise.all([
    publishedSection(HEADER_KEY, locale),
    publishedSection(FOOTER_KEY, locale),
  ]);

  // `path` lets a nav block mark the current entry. A layout cannot know which
  // page is rendering inside it, so middleware.ts puts the pathname on a
  // request header and the chrome reads it here — which keeps the nav a server
  // component instead of a client one that exists only to call usePathname().
  const ctx = {
    locale,
    t,
    business: business
      ? {
          name: business.name,
          tagline: business.tagline,
          defaultLocale: business.defaultLocale,
          enabledLocales: business.enabledLocales,
        }
      : null,
    path: requestHeaders.get(PATH_HEADER) ?? "/",
    localizeHref: business
      ? (href: string) => localizeCustomerHref(href, locale, business)
      : undefined,
  };

  const [headerNodes, footerNodes] = await Promise.all([
    header ? renderBlocks(header.blocks as BlockNode[], ctx) : [],
    footer ? renderBlocks(footer.blocks as BlockNode[], ctx) : [],
  ]);

  return (
    <div className="flex min-h-svh flex-col bg-paper">
      {headerNodes.length > 0 ? (
        <header className="border-b border-rule bg-surface">
          <div className="mx-auto max-w-3xl px-6 py-4">{headerNodes}</div>
        </header>
      ) : null}

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        {children}
      </main>

      {footerNodes.length > 0 ? (
        <footer className="border-t border-rule bg-surface">
          <div className="mx-auto max-w-3xl px-6 py-6 text-sm text-ink-muted">
            {footerNodes}
          </div>
        </footer>
      ) : null}
    </div>
  );
}
