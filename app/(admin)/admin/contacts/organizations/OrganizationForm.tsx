// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useActionState } from "react";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import {
  createOrganizationAction,
  deleteOrganizationAction,
  updateOrganizationAction,
  type ActionState,
} from "../../../actions";
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Field,
  Input,
} from "@/ui/primitives";
import {
  CustomFieldInputs,
  type CustomFieldInputDefinition,
} from "../CustomFieldInputs";

export function OrganizationForm({
  values,
  definitions,
  labels,
  readOnly,
}: {
  values: {
    id?: string;
    name: string;
    domain: string;
    customFields: Record<string, unknown>;
  };
  definitions: CustomFieldInputDefinition[];
  labels: Record<string, string>;
  readOnly: boolean;
}) {
  const editing = Boolean(values.id);
  const [state, action, pending] = useActionState<ActionState, FormData>(
    editing ? updateOrganizationAction : createOrganizationAction,
    {},
  );
  const [deleteState, deleteAction, deleting] = useActionState<ActionState, FormData>(
    deleteOrganizationAction,
    {},
  );
  const generation = state.attempt ?? 0;
  const name = state.values?.name ?? values.name;
  const domain = state.values?.domain ?? values.domain;
  return (
    <Card>
      <form action={action}>
        {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
        <CardHeader title={editing ? labels.details! : labels.new!} />
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
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={labels.name!} htmlFor="name">
              <Input
                key={`name-${generation}`}
                id="name"
                name="name"
                defaultValue={name}
                required
                autoFocus={!editing}
                disabled={readOnly}
              />
            </Field>
            <Field label={labels.domain!} htmlFor="domain" hint={labels.domainHint}>
              <Input
                key={`domain-${generation}`}
                id="domain"
                name="domain"
                defaultValue={domain}
                placeholder={labels.domainPlaceholder}
                disabled={readOnly}
              />
            </Field>
          </div>
          {definitions.length > 0 ? (
            <section className="grid gap-5 border-t border-rule pt-5">
              <div>
                <h3 className="text-sm font-semibold">{labels.customFields}</h3>
                <p className="mt-1 text-xs text-ink-muted">{labels.customFieldsIntro}</p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <CustomFieldInputs
                  definitions={definitions}
                  values={values.customFields}
                  echoed={state.values}
                  generation={generation}
                  readOnly={readOnly}
                  emptyLabel={labels.empty!}
                  yesLabel={labels.yes!}
                  noLabel={labels.no!}
                />
              </div>
            </section>
          ) : null}
        </CardBody>
        <CardFooter>
          {!readOnly ? (
            <Button type="submit" disabled={pending}>
              {pending ? labels.saving : editing ? labels.save : labels.add}
            </Button>
          ) : null}
          <a href="/admin/contacts/organizations" className="text-sm text-ink-muted">
            {labels.cancel}
          </a>
        </CardFooter>
      </form>
      {editing && !readOnly ? (
        <form action={deleteAction} className="border-t border-rule bg-surface-muted px-4 py-3.5">
          <input type="hidden" name="id" value={values.id} />
          {deleteState.error ? (
            <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
              {deleteState.error}
            </Callout>
          ) : null}
          <div className="mt-3 flex items-center gap-3 first:mt-0">
            <Button type="submit" variant="danger" disabled={deleting}>
              {labels.delete}
            </Button>
            <span className="text-xs text-ink-muted">{labels.deleteHint}</span>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
