// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useActionState } from "react";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
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
  countryName,
  currencyName,
  withCurrent,
} from "@/core/settings/defaults";
import { saveBusinessSettingsAction, type ActionState } from "../../actions";

export interface BusinessValues {
  name: string;
  tagline: string;
  schemaType: string;
  country: string;
  baseCurrency: string;
  timezone: string;
  enabledLocales: string[];
  units: "metric" | "imperial";
  firstDayOfWeek: number;
}

export function SettingsForm({ values }: { values: BusinessValues }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    saveBusinessSettingsAction,
    {},
  );
  // Always includes what is stored, so opening this screen can never change a
  // setting just by rendering it.
  const currencies = withCurrent(ALL_CURRENCIES, values.baseCurrency);
  const timezones = withCurrent(ALL_TIMEZONES, values.timezone);
  const countries = withCurrent(
    COUNTRY_DEFAULTS.map((entry) => entry.code),
    values.country,
  );

  return (
    <form action={action}>
      <Card>
        <CardHeader title="Business details" />
        <CardBody>
          {state.error ? (
            <Callout
              tone="danger"
              icon={<WarningCircle size={17} weight="fill" />}
            >
              {state.error}
            </Callout>
          ) : null}
          {state.saved ? (
            <Callout
              tone="success"
              icon={<CheckCircle size={17} weight="fill" />}
            >
              Saved. Your public site uses these straight away.
            </Callout>
          ) : null}

          <Field label="Business name" htmlFor="name">
            <Input id="name" name="name" defaultValue={values.name} required />
          </Field>

          <Field
            label="Tagline"
            htmlFor="tagline"
            hint="Optional. Shown under your name."
          >
            <Input id="tagline" name="tagline" defaultValue={values.tagline} />
          </Field>

          <Field
            label="What kind of business"
            htmlFor="schemaType"
            hint="Search engines use this to describe you."
          >
            <Select
              id="schemaType"
              name="schemaType"
              defaultValue={values.schemaType}
            >
              {BUSINESS_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Country" htmlFor="country">
              <Select id="country" name="country" defaultValue={values.country}>
                {countries.map((code) => (
                  <option key={code} value={code}>
                    {countryName(code)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Currency you charge in" htmlFor="baseCurrency">
              <Select
                id="baseCurrency"
                name="baseCurrency"
                defaultValue={values.baseCurrency}
              >
                {currencies.map((code) => (
                  <option key={code} value={code}>
                    {code} — {currencyName(code)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Time zone" htmlFor="timezone">
              <Select
                id="timezone"
                name="timezone"
                defaultValue={values.timezone}
              >
                {timezones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone.replaceAll("_", " ")}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Week starts on" htmlFor="firstDayOfWeek">
              <Select
                id="firstDayOfWeek"
                name="firstDayOfWeek"
                defaultValue={String(values.firstDayOfWeek)}
              >
                <option value="0">Sunday</option>
                <option value="1">Monday</option>
              </Select>
            </Field>
          </div>

          <Field label="Units" htmlFor="units">
            <div>
              <Segmented
                name="units"
                defaultValue={values.units}
                options={[
                  { value: "metric", label: "Metric" },
                  { value: "imperial", label: "Imperial" },
                ]}
              />
            </div>
          </Field>

          <Field
            label="Languages"
            htmlFor="enabledLocales"
            hint="Comma separated. The first one is your default and stays unprefixed in your web addresses."
          >
            <Input
              id="enabledLocales"
              name="enabledLocales"
              defaultValue={values.enabledLocales.join(", ")}
              className="font-mono"
            />
          </Field>
        </CardBody>
        <CardFooter>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
