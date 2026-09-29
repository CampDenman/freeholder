// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The faceted browse panel (C3.25 slice 2).
//
// Presentational on purpose, like the collection grid: the page parses the
// query, calls catalog.browseProducts and hands this component the facets
// plus an hrefFor callback. Every control is an anchor or a GET form — the
// filter UI is crawlable shape-wise (a crawler can follow each link and
// receive a noindexed, canonicalised view), needs no client JavaScript, and
// renders identically under both themes because it names only token classes.

import type { BrowseQuery } from "../browse-params";
import { hiddenParams, toggleAttributeValue, toggleOption } from "../browse-params";

export interface FacetValue {
  value: string;
  label: string;
  count: number;
}

export interface FacetPanelData {
  options: { code: string; name: string; values: FacetValue[] }[];
  attributes: {
    key: string;
    label: string;
    kind: string;
    unit: string | null;
    values: FacetValue[];
    min: string | null;
    max: string | null;
  }[];
  price: { bands: { fromMinor: number; toMinor: number | null; count: number }[] } | null;
  availability: { inStock: number; outOfStock: number };
}

export interface FacetPanelLabels {
  /** aria-label for the whole filter navigation. */
  nav: string;
  heading: string;
  clearAll: string;
  price: string;
  priceMin: string;
  priceMax: string;
  priceApply: string;
  availability: string;
  inStock: string;
  outOfStock: string;
  /** Range caption for a numeric dimension: "from {min} to {max} {unit}". */
  observedRange: (min: string, max: string, unit: string) => string;
}

function isActive(values: string[], value: string): boolean {
  return values.includes(value);
}

export function FacetPanel({
  facets,
  query,
  hrefFor,
  formatMinor,
  labels,
}: {
  facets: FacetPanelData;
  query: BrowseQuery;
  hrefFor: (query: BrowseQuery) => string;
  formatMinor: (minor: number) => string;
  labels: FacetPanelLabels;
}) {
  const active =
    query.filters.options.length > 0 ||
    query.filters.attributes.length > 0 ||
    query.filters.price !== null ||
    query.filters.availability !== null;

  const priceBandActive = (fromMinor: number, toMinor: number | null): boolean => {
    const price = query.filters.price;
    if (!price) return false;
    return (
      price.min === fromMinor &&
      (toMinor === null ? price.max === undefined : price.max === toMinor)
    );
  };

  return (
    <nav aria-label={labels.nav} className="grid gap-5 rounded-lg border border-rule bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">{labels.heading}</h2>
        {active ? (
          <a className="text-sm text-accent hover:underline" href={hrefFor({ ...query, filters: { options: [], attributes: [], price: null, availability: null }, page: 1 })}>
            {labels.clearAll}
          </a>
        ) : null}
      </div>

      {facets.price ? (
        <section className="grid gap-2">
          <h3 className="text-sm font-semibold text-ink">{labels.price}</h3>
          <ul className="grid list-none gap-1 p-0">
            {facets.price.bands.map((band) => (
              <li key={`${band.fromMinor}-${band.toMinor ?? "up"}`}>
                <a
                  href={hrefFor({
                    ...query,
                    page: 1,
                    filters: {
                      ...query.filters,
                      price: priceBandActive(band.fromMinor, band.toMinor)
                        ? null
                        : { min: band.fromMinor, max: band.toMinor ?? undefined },
                    },
                  })}
                  aria-current={priceBandActive(band.fromMinor, band.toMinor) || undefined}
                  className="flex items-center justify-between gap-2 text-sm text-ink hover:text-accent aria-current:font-semibold aria-current:text-accent"
                >
                  <span>
                    {band.toMinor === null
                      ? `${formatMinor(band.fromMinor)}+`
                      : `${formatMinor(band.fromMinor)} – ${formatMinor(band.toMinor)}`}
                  </span>
                  <span className="text-ink-muted">{band.count}</span>
                </a>
              </li>
            ))}
          </ul>
          <form method="get" className="flex flex-wrap items-center gap-2 text-sm">
            {hiddenParams(query, ["filter[price:min]", "filter[price:max]"]).map((field) => (
              <input key={`${field.name}-${field.value}`} type="hidden" name={field.name} value={field.value} />
            ))}
            <label className="grid gap-0.5 text-ink-muted">
              <span>{labels.priceMin}</span>
              <input
                type="number"
                name="filter[price:min]"
                min={0}
                defaultValue={query.filters.price?.min ?? ""}
                className="w-20 rounded-md border border-rule bg-surface px-2 py-1 text-ink"
              />
            </label>
            <label className="grid gap-0.5 text-ink-muted">
              <span>{labels.priceMax}</span>
              <input
                type="number"
                name="filter[price:max]"
                min={1}
                defaultValue={query.filters.price?.max ?? ""}
                className="w-20 rounded-md border border-rule bg-surface px-2 py-1 text-ink"
              />
            </label>
            <button type="submit" className="rounded-md border border-rule px-3 py-1.5 text-ink">
              {labels.priceApply}
            </button>
          </form>
        </section>
      ) : null}

      <section className="grid gap-2">
        <h3 className="text-sm font-semibold text-ink">{labels.availability}</h3>
        <ul className="grid list-none gap-1 p-0">
          <li>
            <a
              href={hrefFor({
                ...query,
                page: 1,
                filters: {
                  ...query.filters,
                  availability: query.filters.availability === "in_stock" ? null : "in_stock",
                },
              })}
              aria-current={query.filters.availability === "in_stock" || undefined}
              className="flex items-center justify-between gap-2 text-sm text-ink hover:text-accent aria-current:font-semibold aria-current:text-accent"
            >
              <span>{labels.inStock}</span>
              <span className="text-ink-muted">{facets.availability.inStock}</span>
            </a>
          </li>
          <li>
            <span className="flex items-center justify-between gap-2 text-sm text-ink-muted">
              <span>{labels.outOfStock}</span>
              <span>{facets.availability.outOfStock}</span>
            </span>
          </li>
        </ul>
      </section>

      {facets.options.map((dimension) => {
        const selected = query.filters.options.find((option) => option.code === dimension.code);
        return (
          <section key={dimension.code} className="grid gap-2">
            <h3 className="text-sm font-semibold text-ink">{dimension.name}</h3>
            <ul className="grid list-none gap-1 p-0">
              {dimension.values.map((value) => {
                const activeValue = isActive(selected?.values ?? [], value.value);
                return (
                  <li key={value.value}>
                    <a
                      href={hrefFor(toggleOption(query, dimension.code, value.value))}
                      aria-current={activeValue || undefined}
                      className="flex items-center justify-between gap-2 text-sm text-ink hover:text-accent aria-current:font-semibold aria-current:text-accent"
                    >
                      <span>{value.label}</span>
                      <span className="text-ink-muted">{value.count}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {facets.attributes.map((dimension) => {
        const selected = query.filters.attributes.find((attribute) => attribute.key === dimension.key);
        const numeric = dimension.kind === "number" || dimension.kind === "measure";
        return (
          <section key={dimension.key} className="grid gap-2">
            <h3 className="text-sm font-semibold text-ink">{dimension.label}</h3>
            {numeric ? (
              <>
                {dimension.min !== null && dimension.max !== null ? (
                  <p className="m-0 text-sm text-ink-muted">
                    {labels.observedRange(dimension.min, dimension.max, dimension.unit ?? "")}
                  </p>
                ) : null}
                <form method="get" className="flex flex-wrap items-center gap-2 text-sm">
                  {hiddenParams(query, [
                    `filter[attr:${dimension.key}:min]`,
                    `filter[attr:${dimension.key}:max]`,
                  ]).map((field) => (
                    <input key={`${field.name}-${field.value}`} type="hidden" name={field.name} value={field.value} />
                  ))}
                  <input
                    type="number"
                    step="any"
                    name={`filter[attr:${dimension.key}:min]`}
                    defaultValue={selected?.min ?? ""}
                    aria-label={`${dimension.label} min`}
                    className="w-20 rounded-md border border-rule bg-surface px-2 py-1 text-ink"
                  />
                  <input
                    type="number"
                    step="any"
                    name={`filter[attr:${dimension.key}:max]`}
                    defaultValue={selected?.max ?? ""}
                    aria-label={`${dimension.label} max`}
                    className="w-20 rounded-md border border-rule bg-surface px-2 py-1 text-ink"
                  />
                  <button type="submit" className="rounded-md border border-rule px-3 py-1.5 text-ink">
                    {labels.priceApply}
                  </button>
                </form>
              </>
            ) : (
              <ul className="grid list-none gap-1 p-0">
                {dimension.values.map((value) => {
                  const activeValue = isActive(selected?.values ?? [], value.value);
                  return (
                    <li key={value.value}>
                      <a
                        href={hrefFor(toggleAttributeValue(query, dimension.key, value.value))}
                        aria-current={activeValue || undefined}
                        className="flex items-center justify-between gap-2 text-sm text-ink hover:text-accent aria-current:font-semibold aria-current:text-accent"
                      >
                        <span>{value.label}</span>
                        <span className="text-ink-muted">{value.count}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </nav>
  );
}
