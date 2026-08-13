// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from "react";

/** The first keyboard stop on every primary shell (WCAG 2.4.1). */
export function SkipLink({
  children,
  target = "main-content",
}: {
  children: ReactNode;
  target?: string;
}) {
  return (
    <a
      href={`#${target}`}
      className="fixed start-4 top-4 z-[100] -translate-y-24 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent shadow-lg focus-visible:translate-y-0"
    >
      {children}
    </a>
  );
}
