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
  Select,
} from "@/ui/primitives";
import { saveLocationAction, type ActionState } from "../../actions";

export interface LocationValues {
  id: string;
  name: string;
  slug: string;
  street: string;
  unit: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  latitude: string;
  longitude: string;
  phone: string;
  email: string;
  googleBusinessProfileUrl: string;
  priceRange: string;
  schemaType: string;
  sameAs: string;
  status: "visible" | "hidden";
}

export interface LocationFormLabels {
  cardTitle: string;
  name: string;
  nameHint: string;
  slug: string;
  slugHint: string;
  street: string;
  unit: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  countryHint: string;
  latitude: string;
  longitude: string;
  geoHint: string;
  phone: string;
  phoneHint: string;
  email: string;
  gbp: string;
  gbpHint: string;
  priceRange: string;
  priceRangeHint: string;
  schemaType: string;
  schemaTypeHint: string;
  sameAs: string;
  sameAsHint: string;
  status: string;
  visible: string;
  hidden: string;
  submit: string;
  pending: string;
  saved: string;
}

/**
 * One location's details (§4.10).
 *
 * Every address part is its own field rather than one textarea, which is not a
 * preference: PostalAddress JSON-LD needs the components separately, and a
 * crawler comparing this business against a directory listing compares them
 * one at a time. A free-text address would render identically and be worth
 * nothing to the local SEO this screen exists for.
 */
export function LocationForm({
  values,
  labels,
}: {
  values: LocationValues;
  labels: LocationFormLabels;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    saveLocationAction,
    {},
  );
  const value = (key: keyof LocationValues) =>
    state.values?.[key] ?? values[key];

  return (
    <form action={action} key={state.attempt ?? 0}>
      <Card>
        <CardHeader title={labels.cardTitle} />
        <CardBody>
          {state.error ? (
            <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
              {state.error}
            </Callout>
          ) : null}
          {state.saved ? (
            <Callout tone="success" icon={<CheckCircle size={17} weight="fill" />}>
              {labels.saved}
            </Callout>
          ) : null}

          <input type="hidden" name="id" value={values.id} />

          <Field label={labels.name} htmlFor="name" hint={labels.nameHint}>
            <Input id="name" name="name" defaultValue={value("name")} required />
          </Field>

          <Field label={labels.slug} htmlFor="slug" hint={labels.slugHint}>
            <Input id="slug" name="slug" defaultValue={value("slug")} required />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={labels.street} htmlFor="street">
              <Input id="street" name="street" defaultValue={value("street")} />
            </Field>
            <Field label={labels.unit} htmlFor="unit">
              <Input id="unit" name="unit" defaultValue={value("unit")} />
            </Field>
            <Field label={labels.city} htmlFor="city">
              <Input id="city" name="city" defaultValue={value("city")} />
            </Field>
            <Field label={labels.region} htmlFor="region">
              <Input id="region" name="region" defaultValue={value("region")} />
            </Field>
            <Field label={labels.postalCode} htmlFor="postalCode">
              <Input
                id="postalCode"
                name="postalCode"
                defaultValue={value("postalCode")}
              />
            </Field>
            <Field
              label={labels.country}
              htmlFor="country"
              hint={labels.countryHint}
            >
              <Input
                id="country"
                name="country"
                defaultValue={value("country")}
                maxLength={2}
                required
              />
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label={labels.latitude}
              htmlFor="latitude"
              hint={labels.geoHint}
            >
              <Input
                id="latitude"
                name="latitude"
                inputMode="decimal"
                defaultValue={value("latitude")}
              />
            </Field>
            <Field label={labels.longitude} htmlFor="longitude">
              <Input
                id="longitude"
                name="longitude"
                inputMode="decimal"
                defaultValue={value("longitude")}
              />
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={labels.phone} htmlFor="phone" hint={labels.phoneHint}>
              <Input id="phone" name="phone" defaultValue={value("phone")} />
            </Field>
            <Field label={labels.email} htmlFor="email">
              <Input
                id="email"
                name="email"
                type="email"
                defaultValue={value("email")}
              />
            </Field>
          </div>

          <Field label={labels.gbp} htmlFor="googleBusinessProfileUrl" hint={labels.gbpHint}>
            <Input
              id="googleBusinessProfileUrl"
              name="googleBusinessProfileUrl"
              type="url"
              defaultValue={value("googleBusinessProfileUrl")}
            />
          </Field>

          <Field label={labels.sameAs} htmlFor="sameAs" hint={labels.sameAsHint}>
            <Input id="sameAs" name="sameAs" defaultValue={value("sameAs")} />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label={labels.priceRange}
              htmlFor="priceRange"
              hint={labels.priceRangeHint}
            >
              <Input
                id="priceRange"
                name="priceRange"
                defaultValue={value("priceRange")}
              />
            </Field>
            <Field
              label={labels.schemaType}
              htmlFor="schemaType"
              hint={labels.schemaTypeHint}
            >
              <Input
                id="schemaType"
                name="schemaType"
                defaultValue={value("schemaType")}
              />
            </Field>
          </div>

          <Field label={labels.status} htmlFor="status">
            <Select id="status" name="status" defaultValue={value("status")}>
              <option value="visible">{labels.visible}</option>
              <option value="hidden">{labels.hidden}</option>
            </Select>
          </Field>
        </CardBody>
        <CardFooter>
          <Button type="submit" disabled={pending}>
            {pending ? labels.pending : labels.submit}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
