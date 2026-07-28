// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Thin shell only (MASTER.md §32): site chrome is data (Sections), rendered
// here once the cms module lands. No hardcoded site structure in this file.
//
// It owns two things that must be true of every page. The token stylesheet,
// because §32 requires design tokens to be emitted as CSS custom properties at
// request time so an owner's brand is a settings save rather than a rebuild.
// And the theme attribute, stamped server-side from the visitor's cookie —
// which is what makes light and dark a platform standard rather than a
// per-screen decision, and what stops a dark-themed site flashing white while
// JavaScript loads.
import type { ReactNode } from "react";
import { themeStylesheet } from "@/core/design/tokens";
import { themeAttribute } from "@/core/design/theme";
import { readThemePreference } from "./theme";
import "./globals.css";

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const theme = themeAttribute(await readThemePreference());

  return (
    <html lang="en" data-theme={theme}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeStylesheet() }} />
      </head>
      <body className="bg-paper font-sans text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
