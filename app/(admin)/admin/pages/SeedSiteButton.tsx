// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Re-create the starting header, footer and home page.
//
// A form rather than a link, because it changes state. Idempotent, so pressing
// it on a site that already has its chrome does nothing.
import { ensureDefaultsAction } from "../../cms-actions";

export function SeedSiteButton({ label }: { label: string }) {
  return (
    <form action={ensureDefaultsAction}>
      <button
        type="submit"
        className="rounded-md border border-rule px-3 py-1.5 text-sm font-medium text-ink"
      >
        {label}
      </button>
    </form>
  );
}
