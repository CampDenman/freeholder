// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Framed widgets (C9.36). No admin chrome, noindex.
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function EmbedLayout({ children }: { children: ReactNode }) {
  return <div className="p-4">{children}</div>;
}
