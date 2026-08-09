// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useActionState, useId, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle,
  Plus,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
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
import { deriveFieldKey } from "@/modules/forms/fieldKey";
import { saveFormAction, type ActionState } from "../../forms-actions";

export interface BuilderField {
  key: string;
  label: string;
  kind: string;
  required: boolean;
  placeholder?: string;
  help?: string;
  options?: string[];
  /** Locked once an answer has been stored under it — see below. */
  established: boolean;
}

export interface BuilderLabels {
  cardTitle: string;
  intro: string;
  name: string;
  slug: string;
  slugHint: string;
  submitLabel: string;
  successMessage: string;
  successHint: string;
  destination: string;
  destinationContact: string;
  destinationNone: string;
  destinationHint: string;
  notify: string;
  notifyHint: string;
  status: string;
  active: string;
  closed: string;
  questions: string;
  questionsEmpty: string;
  addQuestion: string;
  label: string;
  kind: string;
  required: string;
  placeholder: string;
  help: string;
  options: string;
  optionsHint: string;
  storedAs: string;
  storedAsHint: string;
  storedAsLocked: string;
  moveUp: string;
  moveDown: string;
  remove: string;
  save: string;
  pending: string;
  saved: string;
}

export interface KindOption {
  value: string;
  label: string;
}

const NEEDS_OPTIONS = new Set(["select"]);

/**
 * The form builder (MASTER.md §4.6).
 *
 * Forms have been creatable through the service since the module shipped; this
 * is the screen that means an owner does not need `curl` to add a question.
 *
 * The whole field list is edited in the browser and submitted as one JSON
 * value, rather than each question being its own round trip. That matches how
 * the block editor treats a page: the thing being edited is a document, and a
 * half-saved document is a worse outcome than a slightly larger payload.
 */
export function FieldBuilder({
  formId,
  initial,
  kinds,
  labels,
}: {
  formId: string | null;
  initial: {
    name: string;
    slug: string;
    submitLabel: string;
    successMessage: string;
    destination: string;
    notify: string;
    status: string;
    fields: BuilderField[];
  };
  kinds: KindOption[];
  labels: BuilderLabels;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    saveFormAction,
    {},
  );
  const [fields, setFields] = useState<BuilderField[]>(initial.fields);
  const formHtmlId = useId();

  const update = (index: number, patch: Partial<BuilderField>) => {
    setFields((current) =>
      current.map((field, i) => (i === index ? { ...field, ...patch } : field)),
    );
  };

  const move = (index: number, by: number) => {
    setFields((current) => {
      const next = [...current];
      const target = index + by;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };

  const add = () => {
    setFields((current) => [
      ...current,
      {
        key: deriveFieldKey("question", current.map((f) => f.key)),
        label: "",
        kind: "text",
        required: false,
        established: false,
      },
    ]);
  };

  return (
    <form id={formHtmlId} action={action}>
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

          {formId ? <input type="hidden" name="id" value={formId} /> : null}
          {/* The edited document, in one value. */}
          <input type="hidden" name="fields" value={JSON.stringify(
            fields.map(({ established: _established, ...field }) => ({
              ...field,
              options: NEEDS_OPTIONS.has(field.kind) ? field.options ?? [] : undefined,
            })),
          )} />

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={labels.name} htmlFor="form-name">
              <Input id="form-name" name="name" defaultValue={initial.name} required />
            </Field>
            <Field label={labels.slug} htmlFor="form-slug" hint={labels.slugHint}>
              <Input
                id="form-slug"
                name="slug"
                defaultValue={initial.slug}
                required
                readOnly={Boolean(formId)}
              />
            </Field>
          </div>

          <fieldset className="grid gap-3 border-0 p-0">
            <legend className="text-sm font-semibold text-ink">
              {labels.questions}
            </legend>

            {fields.length === 0 ? (
              <p className="text-sm text-ink-muted">{labels.questionsEmpty}</p>
            ) : null}

            {fields.map((field, index) => (
              <div
                key={index}
                className="grid gap-3 rounded-md border border-rule p-3"
              >
                <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto]">
                  <Field label={labels.label} htmlFor={`label-${index}`}>
                    <Input
                      id={`label-${index}`}
                      value={field.label}
                      onChange={(event) => {
                        const label = event.target.value;
                        // A key follows the question until an answer has been
                        // stored under it, then stops.
                        update(index, {
                          label,
                          ...(field.established
                            ? {}
                            : {
                                key: deriveFieldKey(
                                  label,
                                  fields.filter((_, i) => i !== index).map((f) => f.key),
                                ),
                              }),
                        });
                      }}
                      required
                    />
                  </Field>
                  <Field label={labels.kind} htmlFor={`kind-${index}`}>
                    <Select
                      id={`kind-${index}`}
                      value={field.kind}
                      onChange={(event) => update(index, { kind: event.target.value })}
                    >
                      {kinds.map((kind) => (
                        <option key={kind.value} value={kind.value}>
                          {kind.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div className="flex items-end gap-1 pb-1">
                    <Button
                      type="button"
                      variant="quiet"
                      onClick={() => move(index, -1)}
                      aria-label={labels.moveUp}
                      disabled={index === 0}
                    >
                      <ArrowUp size={14} />
                    </Button>
                    <Button
                      type="button"
                      variant="quiet"
                      onClick={() => move(index, 1)}
                      aria-label={labels.moveDown}
                      disabled={index === fields.length - 1}
                    >
                      <ArrowDown size={14} />
                    </Button>
                    <Button
                      type="button"
                      variant="quiet"
                      onClick={() =>
                        setFields((current) => current.filter((_, i) => i !== index))
                      }
                      aria-label={labels.remove}
                    >
                      <Trash size={14} />
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={labels.placeholder} htmlFor={`placeholder-${index}`}>
                    <Input
                      id={`placeholder-${index}`}
                      value={field.placeholder ?? ""}
                      onChange={(event) =>
                        update(index, { placeholder: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={labels.help} htmlFor={`help-${index}`}>
                    <Input
                      id={`help-${index}`}
                      value={field.help ?? ""}
                      onChange={(event) => update(index, { help: event.target.value })}
                    />
                  </Field>
                </div>

                {NEEDS_OPTIONS.has(field.kind) ? (
                  <Field
                    label={labels.options}
                    htmlFor={`options-${index}`}
                    hint={labels.optionsHint}
                  >
                    <Input
                      id={`options-${index}`}
                      value={(field.options ?? []).join(", ")}
                      onChange={(event) =>
                        update(index, {
                          options: event.target.value
                            .split(",")
                            .map((option) => option.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </Field>
                ) : null}

                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-ink-muted">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(event) =>
                        update(index, { required: event.target.checked })
                      }
                      className="size-4 accent-[var(--color-accent)]"
                    />
                    {labels.required}
                  </label>

                  <label className="flex items-center gap-2 text-xs text-ink-muted">
                    {labels.storedAs}
                    <Input
                      value={field.key}
                      onChange={(event) => update(index, { key: event.target.value })}
                      readOnly={field.established}
                      className="w-40 font-mono text-xs"
                    />
                  </label>
                  <span className="text-xs text-ink-muted">
                    {/* The one thing an owner cannot undo by editing. */}
                    {field.established ? labels.storedAsLocked : labels.storedAsHint}
                  </span>
                </div>
              </div>
            ))}

            <div>
              <Button type="button" variant="quiet" onClick={add}>
                <Plus size={14} weight="bold" />
                {labels.addQuestion}
              </Button>
            </div>
          </fieldset>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={labels.submitLabel} htmlFor="form-submit-label">
              <Input
                id="form-submit-label"
                name="submitLabel"
                defaultValue={initial.submitLabel}
              />
            </Field>
            <Field label={labels.status} htmlFor="form-status">
              <Select id="form-status" name="status" defaultValue={initial.status}>
                <option value="active">{labels.active}</option>
                <option value="closed">{labels.closed}</option>
              </Select>
            </Field>
          </div>

          <Field
            label={labels.successMessage}
            htmlFor="form-success"
            hint={labels.successHint}
          >
            <Input
              id="form-success"
              name="successMessage"
              defaultValue={initial.successMessage}
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label={labels.destination}
              htmlFor="form-destination"
              hint={labels.destinationHint}
            >
              <Select
                id="form-destination"
                name="destination"
                defaultValue={initial.destination}
              >
                <option value="contact">{labels.destinationContact}</option>
                <option value="none">{labels.destinationNone}</option>
              </Select>
            </Field>
            <Field label={labels.notify} htmlFor="form-notify" hint={labels.notifyHint}>
              <Input id="form-notify" name="notify" defaultValue={initial.notify} />
            </Field>
          </div>
        </CardBody>
        <CardFooter>
          <Button type="submit" disabled={pending}>
            {pending ? labels.pending : labels.save}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
