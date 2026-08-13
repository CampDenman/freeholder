// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
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
import { saveBusinessSettingsAction, type ActionState } from "../../actions";
import type {
  BusinessFieldLabels,
  BusinessOptions,
} from "../../../setup/businessLabels";

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

export interface SettingsFormLabels extends BusinessFieldLabels {
  cardTitle: string;
  submit: string;
  pending: string;
  saved: string;
}

export function SettingsForm({
  values,
  labels,
  options,
  readOnly = false,
}: {
  values: BusinessValues;
  labels: SettingsFormLabels;
  /**
   * Built server-side and always containing the stored value, so opening this
   * screen can never change a setting just by rendering it — a select whose
   * options omit its own value falls back to the first one.
   */
  options: BusinessOptions;
  readOnly?: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    saveBusinessSettingsAction,
    {},
  );

  return (
    <form action={readOnly ? undefined : action}>
      <fieldset disabled={readOnly} className="contents">
        <legend className="sr-only">{labels.cardTitle}</legend>
        <Card>
        <CardHeader title={labels.cardTitle} />
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
              {labels.saved}
            </Callout>
          ) : null}

          <Field label={labels.name} htmlFor="name">
            <Input id="name" name="name" defaultValue={values.name} required />
          </Field>

          <Field
            label={labels.tagline}
            htmlFor="tagline"
            hint={labels.taglineHint}
          >
            <Input id="tagline" name="tagline" defaultValue={values.tagline} />
          </Field>

          <Field
            label={labels.schemaType}
            htmlFor="schemaType"
            hint={labels.schemaTypeHint}
          >
            <Select
              id="schemaType"
              name="schemaType"
              defaultValue={values.schemaType}
            >
              {options.businessTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={labels.country} htmlFor="country">
              <Select id="country" name="country" defaultValue={values.country}>
                {options.countries.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={labels.baseCurrency} htmlFor="baseCurrency">
              <Select
                id="baseCurrency"
                name="baseCurrency"
                defaultValue={values.baseCurrency}
              >
                {options.currencies.map((currency) => (
                  <option key={currency.value} value={currency.value}>
                    {currency.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={labels.timezone} htmlFor="timezone">
              <Select
                id="timezone"
                name="timezone"
                defaultValue={values.timezone}
              >
                {options.timezones.map((zone) => (
                  <option key={zone.value} value={zone.value}>
                    {zone.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={labels.firstDayOfWeek} htmlFor="firstDayOfWeek">
              <Select
                id="firstDayOfWeek"
                name="firstDayOfWeek"
                defaultValue={String(values.firstDayOfWeek)}
              >
                <option value="0">{labels.sunday}</option>
                <option value="1">{labels.monday}</option>
              </Select>
            </Field>
          </div>

          <Field label={labels.units} htmlFor="units">
            <div>
              <Segmented
                name="units"
                defaultValue={values.units}
                options={[
                  { value: "metric", label: labels.unitsMetric },
                  { value: "imperial", label: labels.unitsImperial },
                ]}
              />
            </div>
          </Field>

          <Field
            label={labels.locales}
            htmlFor="enabledLocales"
            hint={labels.localesHint}
          >
            <Input
              id="enabledLocales"
              name="enabledLocales"
              defaultValue={values.enabledLocales.join(", ")}
              className="font-mono"
            />
          </Field>
        </CardBody>
          {!readOnly ? (
            <CardFooter>
              <Button type="submit" disabled={pending}>
                {pending ? labels.pending : labels.submit}
              </Button>
            </CardFooter>
          ) : null}
        </Card>
      </fieldset>
    </form>
  );
}
