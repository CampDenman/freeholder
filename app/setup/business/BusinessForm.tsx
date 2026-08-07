// Copyright (C) 2026 Tony Aly
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
import { DEFAULT_COUNTRY, defaultsFor } from "@/core/settings/defaults";
import { saveBusinessAction, type ActionState } from "../actions";
import type { BusinessFieldLabels, BusinessOptions } from "../businessLabels";

export interface BusinessFormLabels extends BusinessFieldLabels {
  submit: string;
  pending: string;
}

/**
 * Option lists arrive already named in the instance's locale — see
 * businessOptions(). This component decides *which* option is suggested; it
 * never decides what an option is called.
 */
export function BusinessForm({
  labels,
  options,
}: {
  labels: BusinessFormLabels;
  options: BusinessOptions;
}) {
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

      <Field label={labels.name} htmlFor="name">
        <Input
          id="name"
          name="name"
          required
          placeholder={labels.namePlaceholder}
        />
      </Field>

      <Field
        label={labels.tagline}
        htmlFor="tagline"
        hint={labels.taglineHint}
      >
        <Input
          id="tagline"
          name="tagline"
          placeholder={labels.taglinePlaceholder}
        />
      </Field>

      <Field
        label={labels.schemaType}
        htmlFor="schemaType"
        hint={labels.schemaTypeHint}
      >
        <Select id="schemaType" name="schemaType" defaultValue="LocalBusiness">
          {options.businessTypes.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={labels.country} htmlFor="country" hint={labels.countryHint}>
        <Select
          id="country"
          name="country"
          value={country}
          onChange={(event) => setCountry(event.target.value)}
        >
          {options.countries.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={labels.baseCurrency} htmlFor="baseCurrency">
          <Select
            id="baseCurrency"
            name="baseCurrency"
            key={`currency-${country}`}
            defaultValue={suggested.currency}
          >
            {options.currencies.map((currency) => (
              <option key={currency.value} value={currency.value}>
                {currency.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={labels.timezone} htmlFor="timezone">
          <Select
            id="timezone"
            name="timezone"
            key={`timezone-${country}`}
            defaultValue={suggested.timezone}
          >
            {options.timezones.map((zone) => (
              <option key={zone.value} value={zone.value}>
                {zone.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={labels.units} htmlFor="units">
          <div>
            <Segmented
              key={`units-${country}`}
              name="units"
              defaultValue={suggested.units}
              options={[
                { value: "metric", label: labels.unitsMetric },
                { value: "imperial", label: labels.unitsImperial },
              ]}
            />
          </div>
        </Field>
        <Field label={labels.firstDayOfWeek} htmlFor="firstDayOfWeek">
          <Select
            id="firstDayOfWeek"
            name="firstDayOfWeek"
            key={`weekstart-${country}`}
            defaultValue={String(suggested.firstDayOfWeek)}
          >
            <option value="0">{labels.sunday}</option>
            <option value="1">{labels.monday}</option>
          </Select>
        </Field>
      </div>

      <input type="hidden" name="locales" value={suggested.locales.join(",")} />

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? labels.pending : labels.submit}
        </Button>
      </div>
    </form>
  );
}
