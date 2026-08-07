// Copyright (C) 2026 Tony Aly
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
import { saveServiceAreaAction, type ActionState } from "../../actions";

export interface ServiceAreaValues {
  kind: "none" | "radius" | "regions";
  centerLatitude: string;
  centerLongitude: string;
  radiusKm: string;
  regions: string;
}

export interface ServiceAreaFormLabels {
  cardTitle: string;
  intro: string;
  kind: string;
  none: string;
  radius: string;
  regions: string;
  centerLatitude: string;
  centerLongitude: string;
  radiusKm: string;
  radiusHint: string;
  regionList: string;
  regionHint: string;
  submit: string;
  pending: string;
  saved: string;
}

/**
 * Where the business will travel to (§4.10).
 *
 * Both shapes are always on screen rather than hidden behind the choice: this
 * form is saved rarely and read once, and a field that appears only after a
 * select changes is a field an owner does not know exists. The action reads
 * whichever set matches the chosen kind.
 */
export function ServiceAreaForm({
  locationId,
  values,
  labels,
}: {
  locationId: string;
  values: ServiceAreaValues;
  labels: ServiceAreaFormLabels;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    saveServiceAreaAction,
    {},
  );

  return (
    <form action={action}>
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
          <p className="max-w-prose text-sm text-ink-muted">{labels.intro}</p>

          <input type="hidden" name="locationId" value={locationId} />

          <Field label={labels.kind} htmlFor="kind">
            <Select id="kind" name="kind" defaultValue={values.kind}>
              <option value="none">{labels.none}</option>
              <option value="radius">{labels.radius}</option>
              <option value="regions">{labels.regions}</option>
            </Select>
          </Field>

          <div className="grid gap-5 sm:grid-cols-3">
            <Field label={labels.centerLatitude} htmlFor="centerLatitude">
              <Input
                id="centerLatitude"
                name="centerLatitude"
                inputMode="decimal"
                defaultValue={values.centerLatitude}
              />
            </Field>
            <Field label={labels.centerLongitude} htmlFor="centerLongitude">
              <Input
                id="centerLongitude"
                name="centerLongitude"
                inputMode="decimal"
                defaultValue={values.centerLongitude}
              />
            </Field>
            <Field
              label={labels.radiusKm}
              htmlFor="radiusKm"
              hint={labels.radiusHint}
            >
              <Input
                id="radiusKm"
                name="radiusKm"
                inputMode="decimal"
                defaultValue={values.radiusKm}
              />
            </Field>
          </div>

          <Field
            label={labels.regionList}
            htmlFor="regions"
            hint={labels.regionHint}
          >
            <Input id="regions" name="regions" defaultValue={values.regions} />
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
