// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Thin shell only (MASTER.md §32): site chrome is data (Sections), rendered
// here once the cms module lands. No hardcoded site structure in this file.
//
// It owns three things that must be true of every page. The token stylesheet,
// because §32 requires design tokens to be emitted as CSS custom properties at
// request time so an owner's brand is a settings save rather than a rebuild.
// And the theme attribute, stamped server-side from the visitor's cookie —
// which is what makes light and dark a platform standard rather than a
// per-screen decision, and what stops a dark-themed site flashing white while
// JavaScript loads.
//
// And the document's language. It said `lang="en"` unconditionally until the
// French pages arrived — which a validator passes, an axe rule passes, and a
// screen reader reads aloud in the wrong accent. §4.9's locale has to reach
// the element that declares it.
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { themeStylesheet } from "@/core/design/tokens";
import { currentDesign } from "@/core/design/read";
import { CSP_NONCE_HEADER } from "@/core/http/csp";
import { themeAttribute } from "@/core/design/theme";
import { readThemePreference } from "./theme";
import { getLocale } from "./i18n";
import { localeDirection } from "@/core/i18n";
import "./globals.css";

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [theme, locale, requestHeaders, design] = await Promise.all([
    readThemePreference().then(themeAttribute),
    getLocale(),
    headers(),
    currentDesign(),
  ]);
  const nonce = requestHeaders.get(CSP_NONCE_HEADER) ?? undefined;

  return (
    <html lang={locale} dir={localeDirection(locale)} data-theme={theme}>
      <head>
        <style
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: themeStylesheet(design.theme, design.extras),
          }}
        />
      </head>
      <body className="bg-paper font-sans text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
