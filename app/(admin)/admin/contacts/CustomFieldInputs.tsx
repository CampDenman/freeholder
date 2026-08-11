// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Typed controls generated from owner-defined field definitions.
import { Field, Input, Select } from "@/ui/primitives";

export interface CustomFieldInputDefinition {
  id: string;
  key: string;
  label: string;
  kind: "text" | "number" | "boolean" | "date" | "select";
  helpText: string | null;
  options: string[];
}

export function CustomFieldInputs({
  definitions,
  values,
  echoed,
  generation,
  readOnly,
  emptyLabel,
  yesLabel,
  noLabel,
}: {
  definitions: CustomFieldInputDefinition[];
  values: Record<string, unknown>;
  echoed?: Record<string, string>;
  generation: number;
  readOnly: boolean;
  emptyLabel: string;
  yesLabel: string;
  noLabel: string;
}) {
  return definitions.map((definition) => {
    const name = `custom:${definition.key}`;
    const stored = values[definition.key];
    const value =
      echoed?.[name] ??
      (typeof stored === "string" ||
      typeof stored === "number" ||
      typeof stored === "boolean"
        ? String(stored)
        : "");
    const id = `custom-${definition.id}`;
    return (
      <div key={definition.id}>
        <input
          type="hidden"
          name="customField"
          value={`${definition.key}|${definition.kind}`}
        />
        <Field label={definition.label} htmlFor={id} hint={definition.helpText ?? undefined}>
          {definition.kind === "select" ? (
            <Select
              key={`${id}-${generation}`}
              id={id}
              name={name}
              defaultValue={value}
              disabled={readOnly}
            >
              <option value="">{emptyLabel}</option>
              {definition.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          ) : definition.kind === "boolean" ? (
            <Select
              key={`${id}-${generation}`}
              id={id}
              name={name}
              defaultValue={value}
              disabled={readOnly}
            >
              <option value="">{emptyLabel}</option>
              <option value="true">{yesLabel}</option>
              <option value="false">{noLabel}</option>
            </Select>
          ) : (
            <Input
              key={`${id}-${generation}`}
              id={id}
              name={name}
              type={
                definition.kind === "number"
                  ? "number"
                  : definition.kind === "date"
                    ? "date"
                    : "text"
              }
              step={definition.kind === "number" ? "any" : undefined}
              defaultValue={value}
              disabled={readOnly}
            />
          )}
        </Field>
      </div>
    );
  });
}
