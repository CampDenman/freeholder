// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useActionState } from "react";
import { BracketsCurly, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import {
  createCustomFieldAction,
  updateCustomFieldAction,
  type ActionState,
} from "../../../actions";
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Pill,
  Select,
} from "@/ui/primitives";

interface Definition {
  id: string;
  entity: "contact" | "organization";
  key: string;
  label: string;
  kind: "text" | "number" | "boolean" | "date" | "select";
  helpText: string | null;
  options: string[];
  position: number;
  active: boolean;
}

function DefinitionEditor({
  definition,
  labels,
}: {
  definition: Definition;
  labels: Record<string, string>;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    updateCustomFieldAction,
    {},
  );
  return (
    <form action={action} className="grid gap-4 border-b border-rule py-5 last:border-0">
      <input type="hidden" name="id" value={definition.id} />
      <input type="hidden" name="kind" value={definition.kind} />
      {state.error ? (
        <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
          {state.error}
        </Callout>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded bg-surface-muted px-2 py-1 text-xs text-ink">
          {definition.key}
        </code>
        <Pill>{labels[`entity.${definition.entity}`]}</Pill>
        <Pill tone="accent">{labels[`kind.${definition.kind}`]}</Pill>
        {!definition.active ? <Pill tone="warning">{labels.inactive}</Pill> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={labels.label!} htmlFor={`label-${definition.id}`}>
          <Input
            id={`label-${definition.id}`}
            name="label"
            defaultValue={definition.label}
            required
          />
        </Field>
        <Field label={labels.help!} htmlFor={`help-${definition.id}`}>
          <Input
            id={`help-${definition.id}`}
            name="helpText"
            defaultValue={definition.helpText ?? ""}
          />
        </Field>
        <Field label={labels.position!} htmlFor={`position-${definition.id}`}>
          <Input
            id={`position-${definition.id}`}
            name="position"
            type="number"
            min={0}
            defaultValue={definition.position}
          />
        </Field>
        <Field label={labels.status!} htmlFor={`active-${definition.id}`}>
          <Select
            id={`active-${definition.id}`}
            name="active"
            defaultValue={String(definition.active)}
          >
            <option value="true">{labels.active}</option>
            <option value="false">{labels.inactive}</option>
          </Select>
        </Field>
      </div>
      {definition.kind === "select" ? (
        <Field label={labels.options!} htmlFor={`options-${definition.id}`} hint={labels.optionsHint}>
          <Input
            id={`options-${definition.id}`}
            name="options"
            defaultValue={definition.options.join(", ")}
          />
        </Field>
      ) : null}
      <div>
        <Button type="submit" variant="quiet" disabled={pending}>
          {pending ? labels.saving : labels.save}
        </Button>
      </div>
    </form>
  );
}

export function CustomFieldManager({
  definitions,
  labels,
}: {
  definitions: Definition[];
  labels: Record<string, string>;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    createCustomFieldAction,
    {},
  );
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader icon={<BracketsCurly size={17} weight="bold" />} title={labels.new!} />
        <CardBody>
          {state.error ? (
            <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
              {state.error}
            </Callout>
          ) : null}
          <form action={action} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label={labels.entity!} htmlFor="entity">
                <Select id="entity" name="entity" defaultValue="contact">
                  <option value="contact">{labels["entity.contact"]}</option>
                  <option value="organization">{labels["entity.organization"]}</option>
                </Select>
              </Field>
              <Field label={labels.key!} htmlFor="key" hint={labels.keyHint}>
                <Input id="key" name="key" placeholder={labels.keyPlaceholder} required />
              </Field>
              <Field label={labels.label!} htmlFor="label">
                <Input id="label" name="label" required />
              </Field>
              <Field label={labels.kind!} htmlFor="kind">
                <Select id="kind" name="kind" defaultValue="text">
                  {(["text", "number", "boolean", "date", "select"] as const).map(
                    (kind) => (
                      <option key={kind} value={kind}>
                        {labels[`kind.${kind}`]}
                      </option>
                    ),
                  )}
                </Select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_1fr_8rem]">
              <Field label={labels.help!} htmlFor="helpText">
                <Input id="helpText" name="helpText" />
              </Field>
              <Field label={labels.options!} htmlFor="options" hint={labels.optionsHint}>
                <Input id="options" name="options" />
              </Field>
              <Field label={labels.position!} htmlFor="position">
                <Input id="position" name="position" type="number" min={0} defaultValue={0} />
              </Field>
            </div>
            <div>
              <Button type="submit" disabled={pending}>
                {pending ? labels.saving : labels.add}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={labels.existing!} />
        <CardBody>
          {definitions.length === 0 ? (
            <p className="text-sm text-ink-muted">{labels.empty}</p>
          ) : (
            <div>
              {definitions.map((definition) => (
                <DefinitionEditor key={definition.id} definition={definition} labels={labels} />
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
