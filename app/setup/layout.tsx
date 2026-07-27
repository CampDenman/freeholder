// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// The first-boot shell (MASTER.md §13). Deliberately not the admin chrome:
// there is no business yet, so there is nothing to navigate.
import type { ReactNode } from "react";
import { Storefront } from "@phosphor-icons/react/dist/ssr";

export default function SetupLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh bg-paper">
      <header className="border-b border-rule bg-surface">
        <div className="mx-auto flex max-w-2xl items-center gap-2.5 px-6 py-4">
          <Storefront size={20} weight="bold" className="text-accent" />
          <span className="text-sm font-semibold">Freeholder</span>
          <span className="ms-auto font-mono text-xs text-ink-muted">
            First-run setup
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-6 py-10">{children}</main>
    </div>
  );
}
