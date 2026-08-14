// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Versioned, source-attributed starter regimes for the built-in tax engine.

export type TaxTemplateGroup =
  | "canada"
  | "european_union"
  | "united_kingdom"
  | "united_states"
  | "australia"
  | "new_zealand";

export interface TaxTemplateRate {
  readonly name: string;
  readonly jurisdiction: string;
  readonly ratePpm: number;
  readonly appliesToShipping: boolean;
  readonly priority?: number;
}

export interface TaxTemplateDefinition {
  readonly key: string;
  readonly version: number;
  readonly group: TaxTemplateGroup;
  readonly name: string;
  readonly country: string;
  readonly regions: readonly string[];
  readonly basis: "origin" | "destination";
  readonly pricesIncludeTax: boolean;
  readonly roundingScope: "line" | "invoice";
  readonly roundingMode: "half_up" | "bankers";
  readonly rates: readonly TaxTemplateRate[];
  readonly source: {
    readonly authority: string;
    readonly url: string;
    readonly checkedOn: string;
  };
  /**
   * Templates are starters, not legal advice. A non-null limitation is also a
   * machine-readable activation interlock: collection cannot be enabled until
   * an owner explicitly confirms that the stated boundary fits their sales.
   */
  readonly activationLimitation: string | null;
}

const CANADA_SOURCE = {
  authority: "Canada Revenue Agency",
  url: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate/calculator.html",
  checkedOn: "2026-08-14",
} as const;

const EU_SOURCE = {
  authority: "European Commission — Your Europe",
  url: "https://europa.eu/youreurope/business/finance-and-tax/vat/vat-rules-rates/index_en.htm",
  checkedOn: "2026-08-14",
} as const;

const UK_SOURCE = {
  authority: "HM Revenue & Customs",
  url: "https://www.gov.uk/how-vat-works/how-much-vat-you-must-charge",
  checkedOn: "2026-08-14",
} as const;

const AU_SOURCE = {
  authority: "Australian Taxation Office",
  url: "https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst",
  checkedOn: "2026-08-14",
} as const;

const NZ_SOURCE = {
  authority: "New Zealand Inland Revenue",
  url: "https://www.ird.govt.nz/gst/charging-gst",
  checkedOn: "2026-08-14",
} as const;

const US_SOURCE = {
  authority: "Streamlined Sales Tax Governing Board",
  url: "https://www.streamlinedsalestax.org/state-tables",
  checkedOn: "2026-08-14",
} as const;

const canadaProvinceRates = [
  ["AB", "Alberta", 50_000, null],
  ["BC", "British Columbia", 50_000, ["PST", 70_000]],
  ["MB", "Manitoba", 50_000, ["RST", 70_000]],
  ["NB", "New Brunswick", 150_000, null],
  ["NL", "Newfoundland and Labrador", 150_000, null],
  ["NT", "Northwest Territories", 50_000, null],
  ["NS", "Nova Scotia", 140_000, null],
  ["NU", "Nunavut", 50_000, null],
  ["ON", "Ontario", 130_000, null],
  ["QC", "Quebec", 50_000, ["QST", 99_750]],
  ["PE", "Prince Edward Island", 150_000, null],
  ["SK", "Saskatchewan", 50_000, ["PST", 60_000]],
  ["YT", "Yukon", 50_000, null],
] as const;

const canadaTemplates: TaxTemplateDefinition[] = canadaProvinceRates.map(
  ([region, province, federalRate, provincial]) => ({
    key: `ca-${region.toLowerCase()}`,
    version: 1,
    group: "canada",
    name: `${province} GST/HST${provincial ? ` + ${provincial[0]}` : ""}`,
    country: "CA",
    regions: [region],
    basis: "destination",
    pricesIncludeTax: false,
    roundingScope: "line",
    roundingMode: "half_up",
    rates: [
      {
        name: federalRate > 50_000 ? "HST" : "GST",
        jurisdiction: federalRate > 50_000 ? province : "Canada",
        ratePpm: federalRate,
        appliesToShipping: true,
        priority: 0,
      },
      ...(provincial
        ? [
            {
              name: provincial[0],
              jurisdiction: province,
              ratePpm: provincial[1],
              // Provincial shipping rules vary with the supply. The standard
              // starter does not silently extend them to freight.
              appliesToShipping: false,
              priority: 10,
            },
          ]
        : []),
    ],
    source: CANADA_SOURCE,
    activationLimitation: provincial
      ? `The ${provincial[0]} starter is the general rate only. Confirm product taxability and provincial shipping treatment before collection.`
      : "The GST/HST starter is the general rate only. Confirm zero-rated and exempt product categories before collection.",
  }),
);

const euStandardRates = [
  ["AT", "Austria", 200_000],
  ["BE", "Belgium", 210_000],
  ["BG", "Bulgaria", 200_000],
  ["CY", "Cyprus", 190_000],
  ["CZ", "Czechia", 210_000],
  ["DE", "Germany", 190_000],
  ["DK", "Denmark", 250_000],
  ["EE", "Estonia", 240_000],
  // The EU table labels Greece "EL"; addresses use the ISO country code GR.
  ["GR", "Greece", 240_000],
  ["ES", "Spain", 210_000],
  ["FI", "Finland", 255_000],
  ["FR", "France", 200_000],
  ["HR", "Croatia", 250_000],
  ["HU", "Hungary", 270_000],
  ["IE", "Ireland", 230_000],
  ["IT", "Italy", 220_000],
  ["LT", "Lithuania", 210_000],
  ["LU", "Luxembourg", 170_000],
  ["LV", "Latvia", 210_000],
  ["MT", "Malta", 180_000],
  ["NL", "Netherlands", 210_000],
  ["PL", "Poland", 230_000],
  ["PT", "Portugal", 230_000],
  ["RO", "Romania", 210_000],
  ["SE", "Sweden", 250_000],
  ["SI", "Slovenia", 220_000],
  ["SK", "Slovakia", 230_000],
] as const;

const euTemplates: TaxTemplateDefinition[] = euStandardRates.map(
  ([country, memberState, ratePpm]) => ({
    key: `eu-${country.toLowerCase()}`,
    version: 1,
    group: "european_union",
    name: `${memberState} standard VAT`,
    country,
    regions: [],
    basis: "destination",
    pricesIncludeTax: true,
    roundingScope: "invoice",
    roundingMode: "half_up",
    rates: [
      {
        name: "VAT",
        jurisdiction: memberState,
        ratePpm,
        appliesToShipping: true,
      },
    ],
    source: EU_SOURCE,
    activationLimitation:
      "This starter installs only the standard VAT rate. Confirm reduced, super-reduced, zero-rated, exempt, territorial, OSS/IOSS, and product place-of-supply rules before collection.",
  }),
);

const singleRateTemplates: TaxTemplateDefinition[] = [
  {
    key: "gb-standard",
    version: 1,
    group: "united_kingdom",
    name: "United Kingdom standard VAT",
    country: "GB",
    regions: [],
    basis: "destination",
    pricesIncludeTax: true,
    roundingScope: "invoice",
    roundingMode: "half_up",
    rates: [{ name: "VAT", jurisdiction: "United Kingdom", ratePpm: 200_000, appliesToShipping: true }],
    source: UK_SOURCE,
    activationLimitation:
      "This starter installs only the standard VAT rate. Confirm reduced, zero-rated, exempt, export, and Northern Ireland treatment before collection.",
  },
  {
    key: "au-standard",
    version: 1,
    group: "australia",
    name: "Australia standard GST",
    country: "AU",
    regions: [],
    basis: "destination",
    pricesIncludeTax: true,
    roundingScope: "invoice",
    roundingMode: "half_up",
    rates: [{ name: "GST", jurisdiction: "Australia", ratePpm: 100_000, appliesToShipping: true }],
    source: AU_SOURCE,
    activationLimitation:
      "This starter installs only the standard GST rate. Confirm GST-free, input-taxed, export, and product-specific treatment before collection.",
  },
  {
    key: "nz-standard",
    version: 1,
    group: "new_zealand",
    name: "New Zealand standard GST",
    country: "NZ",
    regions: [],
    basis: "destination",
    pricesIncludeTax: true,
    roundingScope: "invoice",
    roundingMode: "half_up",
    rates: [{ name: "GST", jurisdiction: "New Zealand", ratePpm: 150_000, appliesToShipping: true }],
    source: NZ_SOURCE,
    activationLimitation:
      "This starter installs only the standard GST rate. Confirm zero-rated, exempt, land, export, and special-supply treatment before collection.",
  },
];

const usStateBaseRates = [
  ["AL", "Alabama", 40_000, true], ["AK", "Alaska", 0, true],
  ["AZ", "Arizona", 56_000, true], ["AR", "Arkansas", 65_000, true],
  ["CA", "California", 72_500, true], ["CO", "Colorado", 29_000, true],
  ["CT", "Connecticut", 63_500, false], ["DE", "Delaware", 0, false],
  ["DC", "District of Columbia", 57_500, false], ["FL", "Florida", 60_000, true],
  ["GA", "Georgia", 40_000, true], ["HI", "Hawaii", 40_000, false],
  ["ID", "Idaho", 60_000, true], ["IL", "Illinois", 62_500, true],
  ["IN", "Indiana", 70_000, false], ["IA", "Iowa", 60_000, true],
  ["KS", "Kansas", 65_000, true], ["KY", "Kentucky", 60_000, false],
  ["LA", "Louisiana", 44_500, true], ["ME", "Maine", 55_000, false],
  ["MD", "Maryland", 60_000, false], ["MA", "Massachusetts", 62_500, false],
  ["MI", "Michigan", 60_000, false], ["MN", "Minnesota", 68_750, true],
  ["MS", "Mississippi", 70_000, true], ["MO", "Missouri", 42_250, true],
  ["MT", "Montana", 0, false], ["NE", "Nebraska", 55_000, true],
  ["NV", "Nevada", 68_500, true], ["NH", "New Hampshire", 0, false],
  ["NJ", "New Jersey", 66_250, false], ["NM", "New Mexico", 51_250, true],
  ["NY", "New York", 40_000, true], ["NC", "North Carolina", 47_500, true],
  ["ND", "North Dakota", 50_000, true], ["OH", "Ohio", 57_500, true],
  ["OK", "Oklahoma", 45_000, true], ["OR", "Oregon", 0, false],
  ["PA", "Pennsylvania", 60_000, true], ["RI", "Rhode Island", 70_000, false],
  ["SC", "South Carolina", 60_000, true], ["SD", "South Dakota", 42_000, true],
  ["TN", "Tennessee", 70_000, true], ["TX", "Texas", 62_500, true],
  ["UT", "Utah", 48_500, true], ["VT", "Vermont", 60_000, true],
  ["VA", "Virginia", 53_000, true], ["WA", "Washington", 65_000, true],
  ["WV", "West Virginia", 60_000, true], ["WI", "Wisconsin", 50_000, true],
  ["WY", "Wyoming", 40_000, true],
] as const;

const usTemplates: TaxTemplateDefinition[] = usStateBaseRates.map(
  ([region, state, ratePpm, hasLocalTaxes]) => ({
    key: `us-${region.toLowerCase()}-base`,
    version: 1,
    group: "united_states",
    name: `${state} state sales-tax base`,
    country: "US",
    regions: [region],
    basis: "destination",
    pricesIncludeTax: false,
    roundingScope: "line",
    roundingMode: "half_up",
    rates: [{ name: "State sales tax", jurisdiction: state, ratePpm, appliesToShipping: false }],
    source: US_SOURCE,
    activationLimitation: hasLocalTaxes
      ? "This is the state base rate, not an address-level checkout rate. Add verified local jurisdiction rates and product/shipping taxability, or use a tax adapter, before collection."
      : "Confirm product, service, digital-goods, shipping, exemption, sourcing, and nexus treatment before collection; a zero state rate does not exclude other transaction taxes.",
  }),
);

export const taxTemplates: readonly TaxTemplateDefinition[] = Object.freeze([
  ...canadaTemplates,
  ...euTemplates,
  ...singleRateTemplates,
  ...usTemplates,
]);

const byKey = new Map(taxTemplates.map((template) => [template.key, template]));

export function taxTemplate(key: string): TaxTemplateDefinition | undefined {
  return byKey.get(key);
}

export function publicTaxTemplate(template: TaxTemplateDefinition) {
  return {
    ...template,
    regions: [...template.regions],
    rates: template.rates.map((rate) => ({ ...rate })),
    source: { ...template.source },
  };
}
