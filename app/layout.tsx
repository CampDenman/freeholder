// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Thin shell only (MASTER.md §32): site chrome is data (Sections), rendered
// here once the cms module lands. No hardcoded site structure in this file.
//
// The one thing it does own is the token stylesheet. §32 requires design
// tokens to be emitted as CSS custom properties *at request time*, so that an
// owner's brand is a settings save rather than a rebuild — which puts them
// here, in the request path, rather than in a static stylesheet.
import type { ReactNode } from "react";
import { themeStylesheet } from "@/core/design/tokens";
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeStylesheet() }} />
      </head>
      <body className="bg-paper font-sans text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
