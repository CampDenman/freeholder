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
import {
  createContactAction,
  updateContactAction,
  type ActionState,
} from "../../actions";
import type { ContactFormLabels } from "./contactLabels";

export interface ContactValues {
  id?: string;
  name: string;
  email: string;
  phone: string;
  lifecycleStage: string;
  tags: string[];
  ownerNotes: string;
}

export function ContactForm({
  values,
  labels,
}: {
  values: ContactValues;
  labels: ContactFormLabels;
}) {
  const editing = Boolean(values.id);
  const [state, action, pending] = useActionState<ActionState, FormData>(
    editing ? updateContactAction : createContactAction,
    {},
  );

  // React resets a form after its action runs — every time, success or not —
  // so a rejected save would otherwise wipe everything the owner just typed.
  // The action hands the text back, and `generation` changes on each failure
  // so these inputs remount and pick the returned values up.
  const echoed = state.values;
  const generation = state.attempt ?? 0;
  const seed = {
    name: echoed?.name ?? values.name,
    email: echoed?.email ?? values.email,
    phone: echoed?.phone ?? values.phone,
    lifecycleStage: echoed?.lifecycleStage ?? values.lifecycleStage,
    tags: echoed?.tags ?? values.tags.join(", "),
    ownerNotes: echoed?.ownerNotes ?? values.ownerNotes,
  };

  return (
    <form action={action}>
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <Card>
        <CardHeader title={editing ? labels.details : labels.newContact} />
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
            <Input
              key={`name-${generation}`}
              id="name"
              name="name"
              defaultValue={seed.name}
              required
              autoFocus={!editing}
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label={labels.email}
              htmlFor="email"
              hint={labels.emailHint}
            >
              <Input
                key={`email-${generation}`}
                id="email"
                name="email"
                type="email"
                defaultValue={seed.email}
              />
            </Field>
            <Field label={labels.phone} htmlFor="phone">
              <Input
                key={`phone-${generation}`}
                id="phone"
                name="phone"
                type="tel"
                defaultValue={seed.phone}
              />
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={labels.stage} htmlFor="lifecycleStage">
              <Select
                key={`stage-${generation}`}
                id="lifecycleStage"
                name="lifecycleStage"
                defaultValue={seed.lifecycleStage}
              >
                {labels.stages.map((stage) => (
                  <option key={stage.value} value={stage.value}>
                    {stage.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={labels.tags} htmlFor="tags" hint={labels.tagsHint}>
              <Input
                key={`tags-${generation}`}
                id="tags"
                name="tags"
                defaultValue={seed.tags}
                className="font-mono"
              />
            </Field>
          </div>

          <Field
            label={labels.notes}
            htmlFor="ownerNotes"
            hint={labels.notesHint}
          >
            <textarea
              key={`notes-${generation}`}
              id="ownerNotes"
              name="ownerNotes"
              rows={3}
              defaultValue={seed.ownerNotes}
              className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink focus-visible:border-accent"
            />
          </Field>
        </CardBody>
        <CardFooter>
          <Button type="submit" disabled={pending}>
            {pending
              ? labels.saving
              : editing
                ? labels.saveChanges
                : labels.add}
          </Button>
          <a href="/admin/contacts" className="text-sm text-ink-muted">
            {labels.cancel}
          </a>
        </CardFooter>
      </Card>
    </form>
  );
}
