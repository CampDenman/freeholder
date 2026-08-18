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
  Select,
} from "@/ui/primitives";
import { resetDesignAction, saveDesignAction, type DesignActionState } from "../../design-actions";

export function DesignForm({
  values,
  logos,
  labels,
}: {
  values: {
    lightAccent: string;
    lightPaper: string;
    lightInk: string;
    darkAccent: string;
    darkPaper: string;
    darkInk: string;
    fontSans: string;
    fontMono: string;
    radius: string;
    motion: string;
    measure: string;
    gutter: string;
    logoAssetId: string;
  };
  logos: { id: string; filename: string }[];
  labels: {
    title: string;
    intro: string;
    light: string;
    dark: string;
    accent: string;
    paper: string;
    ink: string;
    fontSans: string;
    fontMono: string;
    radius: string;
    motion: string;
    measure: string;
    gutter: string;
    logo: string;
    logoNone: string;
    submit: string;
    pending: string;
    saved: string;
    reset: string;
    radiusDefault: string;
    motionDefault: string;
    motionReduced: string;
    measureNarrow: string;
    measureDefault: string;
    measureWide: string;
  };
}) {
  const [state, action, pending] = useActionState<DesignActionState, FormData>(
    saveDesignAction,
    {},
  );
  return (
    <form action={action} className="grid gap-6">
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
      <Card>
        <CardHeader title={labels.light} />
        <CardBody>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={labels.accent} htmlFor="lightAccent">
              <Input id="lightAccent" name="lightAccent" defaultValue={values.lightAccent} />
            </Field>
            <Field label={labels.paper} htmlFor="lightPaper">
              <Input id="lightPaper" name="lightPaper" defaultValue={values.lightPaper} />
            </Field>
            <Field label={labels.ink} htmlFor="lightInk">
              <Input id="lightInk" name="lightInk" defaultValue={values.lightInk} />
            </Field>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={labels.dark} />
        <CardBody>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={labels.accent} htmlFor="darkAccent">
              <Input id="darkAccent" name="darkAccent" defaultValue={values.darkAccent} />
            </Field>
            <Field label={labels.paper} htmlFor="darkPaper">
              <Input id="darkPaper" name="darkPaper" defaultValue={values.darkPaper} />
            </Field>
            <Field label={labels.ink} htmlFor="darkInk">
              <Input id="darkInk" name="darkInk" defaultValue={values.darkInk} />
            </Field>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={labels.title} />
        <CardBody>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={labels.fontSans} htmlFor="fontSans">
              <Select id="fontSans" name="fontSans" defaultValue={values.fontSans}>
                <option value="">{labels.radiusDefault}</option>
                <option value='system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'>
                  System
                </option>
              </Select>
            </Field>
            <Field label={labels.fontMono} htmlFor="fontMono">
              <Select id="fontMono" name="fontMono" defaultValue={values.fontMono}>
                <option value="">{labels.radiusDefault}</option>
                <option value="ui-monospace, SFMono-Regular, Menlo, monospace">
                  System
                </option>
              </Select>
            </Field>
            <Field label={labels.radius} htmlFor="radius">
              <Select id="radius" name="radius" defaultValue={values.radius}>
                <option value="">{labels.radiusDefault}</option>
                <option value="0.25rem">4px</option>
                <option value="0.375rem">6px</option>
                <option value="0.5rem">8px</option>
                <option value="0.75rem">12px</option>
              </Select>
            </Field>
            <Field label={labels.motion} htmlFor="motion">
              <Select id="motion" name="motion" defaultValue={values.motion}>
                <option value="">{labels.motionDefault}</option>
                <option value="120ms">120ms</option>
                <option value="180ms">180ms</option>
                <option value="0.01ms">{labels.motionReduced}</option>
              </Select>
            </Field>
            <Field label={labels.measure} htmlFor="measure">
              <Select id="measure" name="measure" defaultValue={values.measure}>
                <option value="">{labels.measureDefault}</option>
                <option value="36rem">{labels.measureNarrow}</option>
                <option value="48rem">{labels.measureDefault}</option>
                <option value="56rem">{labels.measureWide}</option>
              </Select>
            </Field>
            <Field label={labels.gutter} htmlFor="gutter">
              <Select id="gutter" name="gutter" defaultValue={values.gutter}>
                <option value="">{labels.measureDefault}</option>
                <option value="1rem">16px</option>
                <option value="1.5rem">24px</option>
                <option value="2rem">32px</option>
              </Select>
            </Field>
            <Field label={labels.logo} htmlFor="logoAssetId">
              <Select id="logoAssetId" name="logoAssetId" defaultValue={values.logoAssetId}>
                <option value="">{labels.logoNone}</option>
                {logos.map((logo) => (
                  <option key={logo.id} value={logo.id}>
                    {logo.filename}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
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

export function ResetDesignButton({ label }: { label: string }) {
  return (
    <form action={resetDesignAction}>
      <Button type="submit" variant="quiet">
        {label}
      </Button>
    </form>
  );
}
