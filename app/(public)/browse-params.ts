// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The storefront browse URL codec (C3.25 slice 2).
//
// Filter state lives in query params — never in paths, never in client
// stores — because the SEO doctrine (src/core/seo/meta.ts) already classifies
// every filter-shaped query as a filtered view of its clean URL: noindexed,
// canonicalised back, and robots-disallowed. A facet link must therefore be a
// plain anchor a crawler can follow and a visitor can copy, and both the
// collection page and the search page must read the same params the same way.
//
// Param grammar (repeatable keys collapse to string[]):
//   filter[option:<code>]=<skuFragment>     one per pick; same code ORs
//   filter[attr:<key>]=<value>              text/enum/bool ("true"/"false")
//   filter[attr:<key>:min]=<decimal>        number/measure lower bound
//   filter[attr:<key>:max]=<decimal>        number/measure upper bound
//   filter[price:min]=<int>                 minor units, lower bound
//   filter[price:max]=<int>                 minor units, upper bound
//   filter[availability]=in_stock
//   sort=featured|price-asc|price-desc|newest|title
//   page=<n>
//
// Ranges use suffixed keys so a plain GET form with two named inputs can set
// them without any client script. Parsing is fail-closed: anything malformed
// or unknown is dropped, so a hand-edited URL degrades to a broader shelf
// instead of an error page.

import type { BrowseSortOrder } from "@/modules/catalog/contract";
import { BROWSE_SORT_ORDERS } from "@/modules/catalog/contract";

export interface BrowseFilterState {
  options: { code: string; values: string[] }[];
  attributes: { key: string; values: string[]; min?: string; max?: string }[];
  price: { min?: number; max?: number } | null;
  availability: "in_stock" | null;
}

export interface BrowseQuery {
  filters: BrowseFilterState;
  sort: BrowseSortOrder | null;
  page: number;
}

export const EMPTY_BROWSE_QUERY: BrowseQuery = {
  filters: { options: [], attributes: [], price: null, availability: null },
  sort: null,
  page: 1,
};

type RawQuery = Record<string, string | string[] | undefined>;

const OPTION_KEY = /^filter\[option:([a-z0-9][a-z0-9-]{0,39})\]$/;
const ATTRIBUTE_KEY = /^filter\[attr:([a-z0-9][a-z0-9_]{0,39})(?::(min|max))?\]$/;
const PRICE_MIN_KEY = "filter[price:min]";
const PRICE_MAX_KEY = "filter[price:max]";
const AVAILABILITY_KEY = "filter[availability]";
const FRAGMENT = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DECIMAL = /^-?[0-9]+(?:\.[0-9]+)?$/;

function valuesOf(value: string | string[] | undefined): string[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return list.filter((entry): entry is string => typeof entry === "string");
}

function firstInteger(value: string | string[] | undefined): number | undefined {
  const raw = valuesOf(value)[0];
  if (raw === undefined || !/^[0-9]+$/.test(raw)) return undefined;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function firstDecimal(value: string | string[] | undefined): string | undefined {
  const raw = valuesOf(value)[0];
  return raw !== undefined && DECIMAL.test(raw) && raw.length <= 40 ? raw : undefined;
}

export function parseBrowseQuery(query: RawQuery): BrowseQuery {
  const parsed: BrowseQuery = {
    filters: { options: [], attributes: [], price: null, availability: null },
    sort: null,
    page: 1,
  };

  const optionMap = new Map<string, string[]>();
  const attributeMap = new Map<string, { values: string[]; min?: string; max?: string }>();
  let priceMin: number | undefined;
  let priceMax: number | undefined;

  for (const key of Object.keys(query)) {
    const optionMatch = OPTION_KEY.exec(key);
    if (optionMatch) {
      const values = optionMap.get(optionMatch[1]!) ?? [];
      for (const entry of valuesOf(query[key])) {
        if (FRAGMENT.test(entry) && !values.includes(entry)) values.push(entry);
      }
      optionMap.set(optionMatch[1]!, values);
      continue;
    }
    const attributeMatch = ATTRIBUTE_KEY.exec(key);
    if (attributeMatch) {
      const attribute = attributeMap.get(attributeMatch[1]!) ?? { values: [] };
      if (attributeMatch[2] === "min") {
        attribute.min = firstDecimal(query[key]) ?? attribute.min;
      } else if (attributeMatch[2] === "max") {
        attribute.max = firstDecimal(query[key]) ?? attribute.max;
      } else {
        for (const entry of valuesOf(query[key])) {
          if (entry.length > 0 && entry.length <= 500 && !attribute.values.includes(entry)) {
            attribute.values.push(entry);
          }
        }
      }
      attributeMap.set(attributeMatch[1]!, attribute);
      continue;
    }
    if (key === PRICE_MIN_KEY) {
      priceMin = firstInteger(query[key]);
      continue;
    }
    if (key === PRICE_MAX_KEY) {
      priceMax = firstInteger(query[key]);
      continue;
    }
    if (key === AVAILABILITY_KEY) {
      if (valuesOf(query[key]).includes("in_stock")) parsed.filters.availability = "in_stock";
      continue;
    }
    if (key === "sort") {
      const value = valuesOf(query[key])[0];
      if (value && (BROWSE_SORT_ORDERS as readonly string[]).includes(value)) {
        parsed.sort = value as BrowseSortOrder;
      }
      continue;
    }
    if (key === "page") {
      const value = Number(valuesOf(query[key])[0]);
      if (Number.isInteger(value) && value > 0) parsed.page = value;
    }
  }

  // An inverted range matches nothing; drop it rather than minting a dead URL.
  if (priceMin !== undefined && priceMax !== undefined && priceMin >= priceMax) {
    priceMin = undefined;
    priceMax = undefined;
  }
  if (priceMin !== undefined || priceMax !== undefined) {
    parsed.filters.price = { min: priceMin, max: priceMax };
  }

  parsed.filters.options = [...optionMap.entries()]
    .filter(([, values]) => values.length > 0)
    .map(([code, values]) => ({ code, values: values.sort() }))
    .sort((left, right) => left.code.localeCompare(right.code));
  parsed.filters.attributes = [...attributeMap.entries()]
    .map(([key, attribute]) => ({
      key,
      values: attribute.values.sort(),
      min: attribute.min,
      max: attribute.max,
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
  return parsed;
}

/** The keys a dimension owns, for building a form that preserves the rest. */
export function attributeParamKeys(key: string): string[] {
  return [`filter[attr:${key}]`, `filter[attr:${key}:min]`, `filter[attr:${key}:max]`];
}

export const PRICE_PARAM_KEYS = [PRICE_MIN_KEY, PRICE_MAX_KEY];

/**
 * The deterministic string form, shared by every facet link on a page. Keys
 * sort, multi-values sort, and defaults (featured sort, page one) stay out of
 * the URL — the clean address must be byte-identical everywhere it appears.
 */
export function browseQueryString(query: BrowseQuery): string {
  const params: string[] = [];
  const key = (raw: string) => `filter%5B${encodeURIComponent(raw.slice(7, -1))}%5D`;
  for (const option of query.filters.options) {
    for (const value of option.values) {
      params.push(`${key(`filter[option:${option.code}]`)}=${encodeURIComponent(value)}`);
    }
  }
  for (const attribute of query.filters.attributes) {
    for (const value of attribute.values) {
      params.push(`${key(`filter[attr:${attribute.key}]`)}=${encodeURIComponent(value)}`);
    }
    if (attribute.min !== undefined) {
      params.push(`${key(`filter[attr:${attribute.key}:min]`)}=${encodeURIComponent(attribute.min)}`);
    }
    if (attribute.max !== undefined) {
      params.push(`${key(`filter[attr:${attribute.key}:max]`)}=${encodeURIComponent(attribute.max)}`);
    }
  }
  if (query.filters.price) {
    if (query.filters.price.min !== undefined) {
      params.push(`${key(PRICE_MIN_KEY)}=${query.filters.price.min}`);
    }
    if (query.filters.price.max !== undefined) {
      params.push(`${key(PRICE_MAX_KEY)}=${query.filters.price.max}`);
    }
  }
  if (query.filters.availability) {
    params.push(`${key(AVAILABILITY_KEY)}=${query.filters.availability}`);
  }
  if (query.sort && query.sort !== "featured") {
    params.push(`sort=${query.sort}`);
  }
  if (query.page > 1) {
    params.push(`page=${query.page}`);
  }
  return params.join("&");
}

/** The service's filter input, shaped exactly as catalog.browseProducts reads. */
export function browseServiceFilters(query: BrowseQuery) {
  return {
    options: query.filters.options.map((option) => ({ code: option.code, values: option.values })),
    attributes: query.filters.attributes
      .filter(
        (attribute) =>
          attribute.values.length > 0 || attribute.min !== undefined || attribute.max !== undefined,
      )
      .map((attribute) => ({
        key: attribute.key,
        values: attribute.values,
        min: attribute.min,
        max: attribute.max,
      })),
    price:
      query.filters.price &&
      (query.filters.price.min !== undefined || query.filters.price.max !== undefined)
        ? query.filters.price
        : null,
    availability: query.filters.availability ?? undefined,
  };
}

/** Toggle one option value; empty dimensions drop out of the query. */
export function toggleOption(query: BrowseQuery, code: string, value: string): BrowseQuery {
  const existing = query.filters.options.find((option) => option.code === code);
  const options = existing
    ? query.filters.options.map((option) =>
        option.code === code
          ? {
              ...option,
              values: option.values.includes(value)
                ? option.values.filter((entry) => entry !== value)
                : [...option.values, value].sort(),
            }
          : option,
      )
    : [...query.filters.options, { code, values: [value] }];
  return {
    ...query,
    page: 1,
    filters: { ...query.filters, options: options.filter((option) => option.values.length > 0) },
  };
}

export function toggleAttributeValue(
  query: BrowseQuery,
  key: string,
  value: string,
): BrowseQuery {
  const existing = query.filters.attributes.find((attribute) => attribute.key === key);
  const attributes = existing
    ? query.filters.attributes.map((attribute) =>
        attribute.key === key
          ? {
              ...attribute,
              values: attribute.values.includes(value)
                ? attribute.values.filter((entry) => entry !== value)
                : [...attribute.values, value].sort(),
            }
          : attribute,
      )
    : [...query.filters.attributes, { key, values: [value] }];
  return {
    ...query,
    page: 1,
    filters: {
      ...query.filters,
      attributes: attributes.filter(
        (attribute) =>
          attribute.values.length > 0 || attribute.min !== undefined || attribute.max !== undefined,
      ),
    },
  };
}

export function setPrice(query: BrowseQuery, band: { min?: number; max?: number } | null): BrowseQuery {
  return {
    ...query,
    page: 1,
    filters: {
      ...query.filters,
      price: band && (band.min !== undefined || band.max !== undefined) ? band : null,
    },
  };
}

export function setAvailability(query: BrowseQuery, value: "in_stock" | null): BrowseQuery {
  return { ...query, page: 1, filters: { ...query.filters, availability: value } };
}

export function setSort(query: BrowseQuery, sort: BrowseSortOrder): BrowseQuery {
  return { ...query, page: 1, sort: sort === "featured" ? null : sort };
}

export function setPage(query: BrowseQuery, page: number): BrowseQuery {
  return { ...query, page: Math.max(1, page) };
}

export function clearFilters(query: BrowseQuery): BrowseQuery {
  return { ...EMPTY_BROWSE_QUERY, sort: query.sort };
}

/**
 * Every param of the current query except the ones `excludeKeys` owns, as
 * hidden-input pairs — a GET range form submits itself without discarding
 * the filters the shopper already chose.
 */
export function hiddenParams(
  query: BrowseQuery,
  excludeKeys: string[],
): { name: string; value: string }[] {
  const excluded = new Set(excludeKeys);
  const raw = new URLSearchParams(browseQueryString(query));
  const hidden: { name: string; value: string }[] = [];
  for (const [name, value] of raw.entries()) {
    if (!excluded.has(name)) hidden.push({ name, value });
  }
  return hidden;
}
