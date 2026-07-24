// SPDX-License-Identifier: AGPL-3.0-only
// Thin shell only (MASTER.md §32): site chrome is data (Sections), rendered
// here once the cms module lands. No hardcoded site structure in this file.
import type { ReactNode } from "react";
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-bg font-sans text-fg antialiased">{children}</body>
    </html>
  );
}
