// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useActionState, useState } from "react";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import {
  Button,
  Callout,
  Field,
  Input,
  Segmented,
  Select,
} from "@/ui/primitives";
import {
  ALL_CURRENCIES,
  ALL_TIMEZONES,
  BUSINESS_TYPES,
  COUNTRY_DEFAULTS,
  DEFAULT_COUNTRY,
  countryName,
  currencyName,
  defaultsFor,
} from "@/core/settings/defaults";
import { saveBusinessAction, type ActionState } from "../actions";

// The full lists, not the country table's samples: that table suggests a
// default, it does not limit what a business may choose.
const CURRENCIES = ALL_CURRENCIES;
const TIMEZONES = ALL_TIMEZONES;

export function BusinessForm() {
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [state, action, pending] = useActionState<ActionState, FormData>(
    saveBusinessAction,
    {},
  );
  // Answering the country question fills in the rest, and every one of them
  // stays editable — the point is not to ask five questions when one implies
  // the other four. The `key` on each control re-seeds it when country moves.
  const suggested = defaultsFor(country);

  return (
    <form action={action} className="grid gap-5">
      {state.error ? (
        <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
          {state.error}
        </Callout>
      ) : null}

      <Field label="Business name" htmlFor="name">
        <Input
          id="name"
          name="name"
          required
          placeholder="Aurora Coast Photography"
        />
      </Field>

      <Field
        label="Tagline"
        htmlFor="tagline"
        hint="Optional. Shown under your name."
      >
        <Input
          id="tagline"
          name="tagline"
          placeholder="Coastal light, honestly made"
        />
      </Field>

      <Field
        label="What kind of business"
        htmlFor="schemaType"
        hint="Search engines use this to describe you. It can change later."
      >
        <Select id="schemaType" name="schemaType" defaultValue="LocalBusiness">
          {BUSINESS_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Country" htmlFor="country" hint="Sets the defaults below.">
        <Select
          id="country"
          name="country"
          value={country}
          onChange={(event) => setCountry(event.target.value)}
        >
          {COUNTRY_DEFAULTS.map((entry) => (
            <option key={entry.code} value={entry.code}>
              {countryName(entry.code)}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Currency you charge in" htmlFor="baseCurrency">
          <Select
            id="baseCurrency"
            name="baseCurrency"
            key={`currency-${country}`}
            defaultValue={suggested.currency}
          >
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code} — {currencyName(code)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Time zone" htmlFor="timezone">
          <Select
            id="timezone"
            name="timezone"
            key={`timezone-${country}`}
            defaultValue={suggested.timezone}
          >
            {TIMEZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replaceAll("_", " ")}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Units" htmlFor="units">
          <div>
            <Segmented
              key={`units-${country}`}
              name="units"
              defaultValue={suggested.units}
              options={[
                { value: "metric", label: "Metric" },
                { value: "imperial", label: "Imperial" },
              ]}
            />
          </div>
        </Field>
        <Field label="Week starts on" htmlFor="firstDayOfWeek">
          <Select
            id="firstDayOfWeek"
            name="firstDayOfWeek"
            key={`weekstart-${country}`}
            defaultValue={String(suggested.firstDayOfWeek)}
          >
            <option value="0">Sunday</option>
            <option value="1">Monday</option>
          </Select>
        </Field>
      </div>

      <input type="hidden" name="locales" value={suggested.locales.join(",")} />

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save and continue"}
        </Button>
      </div>
    </form>
  );
}
