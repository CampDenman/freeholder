// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useActionState } from "react";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardFooter,
  Field,
  Input,
} from "@/ui/primitives";
import { saveSetupLocationAction, type ActionState } from "../actions";

export interface LocationStepLabels {
  name: string;
  street: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  countryHint: string;
  phone: string;
  phoneHint: string;
  submit: string;
  skip: string;
  pending: string;
}

/**
 * The smallest useful NAP (§13 step 4).
 *
 * Fewer fields than the admin screen on purpose: coordinates, price range and
 * profile links are all things an owner can add later from a screen with room
 * to explain them, and a wizard that asks for twelve fields before showing
 * anything is a wizard people abandon. What is here is what a directory
 * listing compares.
 */
export function LocationStepForm({
  defaults,
  labels,
}: {
  defaults: { name: string; country: string };
  labels: LocationStepLabels;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    saveSetupLocationAction,
    {},
  );

  return (
    <form action={action}>
      <Card>
        <CardBody>
          {state.error ? (
            <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
              {state.error}
            </Callout>
          ) : null}

          <Field label={labels.name} htmlFor="name">
            <Input id="name" name="name" defaultValue={defaults.name} />
          </Field>
          <Field label={labels.street} htmlFor="street">
            <Input id="street" name="street" />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={labels.city} htmlFor="city">
              <Input id="city" name="city" />
            </Field>
            <Field label={labels.region} htmlFor="region">
              <Input id="region" name="region" />
            </Field>
            <Field label={labels.postalCode} htmlFor="postalCode">
              <Input id="postalCode" name="postalCode" />
            </Field>
            <Field
              label={labels.country}
              htmlFor="country"
              hint={labels.countryHint}
            >
              <Input
                id="country"
                name="country"
                maxLength={2}
                defaultValue={defaults.country}
              />
            </Field>
          </div>
          <Field label={labels.phone} htmlFor="phone" hint={labels.phoneHint}>
            <Input id="phone" name="phone" />
          </Field>
        </CardBody>
        <CardFooter>
          <Button type="submit" disabled={pending}>
            {pending ? labels.pending : labels.submit}
          </Button>
          {/* Skipping is a submit, not a link: it goes through the same action,
              which writes nothing and moves on. A link would leave the typed
              fields looking as though they had been saved. */}
          <Button type="submit" name="skip" value="1" variant="quiet" disabled={pending}>
            {labels.skip}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
