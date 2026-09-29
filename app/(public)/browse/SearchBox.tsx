// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The storefront search box (C3.25 slice 2).
//
// A plain GET form: the term is a query param (the SEO doctrine's q), the
// action is the localized /search address, and no JavaScript is required.

export interface SearchBoxLabels {
  aria: string;
  placeholder: string;
  submit: string;
}

export function SearchBox({
  action,
  term,
  labels,
}: {
  /** The localized /search path this instance answers on. */
  action: string;
  term: string;
  labels: SearchBoxLabels;
}) {
  return (
    <form role="search" method="get" action={action} className="flex items-center gap-2">
      <label htmlFor="storefront-search" className="sr-only">
        {labels.aria}
      </label>
      <input
        id="storefront-search"
        type="search"
        name="q"
        defaultValue={term}
        placeholder={labels.placeholder}
        className="w-full max-w-md rounded-md border border-rule bg-surface px-3 py-2 text-ink"
      />
      <button type="submit" className="rounded-md border border-rule px-4 py-2 text-ink hover:text-accent">
        {labels.submit}
      </button>
    </form>
  );
}
