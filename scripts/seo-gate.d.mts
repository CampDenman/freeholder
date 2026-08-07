// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Types for the SEO gate (MASTER.md §5, §15.2). See schema-compat-gate.d.mts
// for why the gate stays .mjs and its types live beside it.

export interface SeoProblem {
  /** The page, as a URL or a comma-joined list where a problem spans pages. */
  url: string;
  message: string;
}

export interface PageAudit {
  problems: SeoProblem[];
  /** Every href found, for the crawler to follow. */
  links: string[];
  title: string | null;
  description: string | null;
  /**
   * False when the page names a *different* URL as canonical — a second
   * address for one page, which the uniqueness rules must not hold to account.
   */
  isCanonical?: boolean;
}

export function auditPage(input: {
  url: string;
  html: string;
  status: number;
  /** How many locales the instance publishes; hreflang is checked above one. */
  locales?: number;
}): PageAudit;
