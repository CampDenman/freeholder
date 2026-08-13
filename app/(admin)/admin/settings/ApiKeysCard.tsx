// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useActionState } from "react";
import {
  CheckCircle,
  Key,
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
  Pill,
  Select,
} from "@/ui/primitives";
import {
  createApiKeyAction,
  revokeApiKeyAction,
  type ActionState,
} from "../../actions";

export interface ScopeArea {
  area: string;
  family: string;
  /** Names of this area's query services, for the read-only choice. */
  reads: string[];
  /** How many services the area has in total, so "full" means something. */
  total: number;
}

export interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsed: string | null;
  expires: string | null;
}

export interface ApiKeysLabels {
  cardTitle: string;
  intro: string;
  name: string;
  nameHint: string;
  expiry: string;
  expiryHint: string;
  never: string;
  access: string;
  none: string;
  read: string;
  full: string;
  create: string;
  pending: string;
  created: string;
  createdHint: string;
  existing: string;
  empty: string;
  neverUsed: string;
  lastUsed: string;
  expiresOn: string;
  revoke: string;
  revokeConfirm: string;
  publicOnly: string;
}

const FORM_ID = "new-api-key";

/**
 * API keys (§26, §28).
 *
 * Access is chosen per area as none / read / full rather than as a checklist
 * of every service, because a checklist of sixty checkboxes is one people tick
 * "select all" on — and the whole point of scopes is that most keys should be
 * small. The three choices still resolve to explicit service names in the
 * database, so nothing about the model is coarsened; only the question is.
 */
export function ApiKeysCard({
  areas,
  keys,
  labels,
}: {
  areas: ScopeArea[];
  keys: KeyRow[];
  labels: ApiKeysLabels;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    createApiKeyAction,
    {},
  );

  return (
    <Card>
      <CardHeader icon={<Key size={17} weight="fill" />} title={labels.cardTitle} />
      <CardBody>
        <p className="max-w-prose text-sm text-ink-muted">{labels.intro}</p>

        {/* The one moment the token exists outside the database. */}
        {state.saved && state.message ? (
          <Callout tone="success" icon={<CheckCircle size={17} weight="fill" />}>
            <span className="grid gap-1.5">
              <span className="font-semibold">{labels.created}</span>
              <code className="block overflow-x-auto rounded bg-surface-muted px-2 py-1.5 font-mono text-xs text-ink">
                {state.message}
              </code>
              <span className="text-xs">{labels.createdHint}</span>
            </span>
          </Callout>
        ) : null}

        {keys.length > 0 ? (
          <div className="grid gap-2">
            <h3 className="text-sm font-semibold text-ink">{labels.existing}</h3>
            <ul className="grid list-none gap-2 p-0">
              {keys.map((key) => (
                <li
                  key={key.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-rule pb-2 last:border-0"
                >
                  <span className="font-semibold text-ink">{key.name}</span>
                  <code className="font-mono text-xs text-ink-muted">
                    {key.prefix}…
                  </code>
                  {key.scopes.length === 0 ? (
                    <Pill tone="neutral">{labels.publicOnly}</Pill>
                  ) : (
                    key.scopes.map((scope) => (
                      <Pill key={scope} tone="accent">
                        {scope}
                      </Pill>
                    ))
                  )}
                  <span className="text-xs text-ink-muted">
                    {key.lastUsed
                      ? `${labels.lastUsed} ${key.lastUsed}`
                      : labels.neverUsed}
                    {key.expires ? ` · ${labels.expiresOn} ${key.expires}` : ""}
                  </span>
                  <span className="ms-auto">
                    <RevokeButton
                      id={key.id}
                      label={labels.revoke}
                      confirm={labels.revokeConfirm}
                    />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">{labels.empty}</p>
        )}

        <form
          id={FORM_ID}
          action={action}
          className="grid gap-5 border-t border-rule pt-5"
        >
          {state.error ? (
            <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
              {state.error}
            </Callout>
          ) : null}

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={labels.name} htmlFor="key-name" hint={labels.nameHint}>
              <Input id="key-name" name="name" required maxLength={80} />
            </Field>
            <Field
              label={labels.expiry}
              htmlFor="key-expiry"
              hint={labels.expiryHint}
            >
              <Select id="key-expiry" name="expiresInDays" defaultValue="">
                <option value="">{labels.never}</option>
                <option value="30">30</option>
                <option value="90">90</option>
                <option value="365">365</option>
              </Select>
            </Field>
          </div>

          <fieldset className="grid gap-2 border-0 p-0">
            <legend className="mb-1 text-sm font-semibold text-ink">
              {labels.access}
            </legend>
            {areas.map((area) => (
              <div
                key={area.area}
                className="grid items-center gap-2 sm:grid-cols-[12rem_1fr]"
              >
                <label
                  htmlFor={`access-${area.area}`}
                  className="font-mono text-xs text-ink-muted"
                >
                  {area.area}
                </label>
                <Select
                  id={`access-${area.area}`}
                  name={`access-${area.area}`}
                  defaultValue="none"
                >
                  <option value="none">{labels.none}</option>
                  {area.reads.length > 0 ? (
                    <option value="read">{labels.read}</option>
                  ) : null}
                  <option value="full">{labels.full}</option>
                </Select>
                {/* What "read" means for this area, resolved server-side from
                    the registry so the action never has to guess. */}
                <input
                  type="hidden"
                  name={`reads-${area.area}`}
                  value={area.reads.join(",")}
                />
              </div>
            ))}
          </fieldset>
        </form>
      </CardBody>
      <CardFooter>
        {/* The button lives in the footer and the form in the body, so it is
            associated by id rather than by nesting. Without this it would
            submit nothing — a submit button outside a form is inert. */}
        <Button type="submit" form={FORM_ID} disabled={pending}>
          {pending ? labels.pending : labels.create}
        </Button>
      </CardFooter>
    </Card>
  );
}

function RevokeButton({
  id,
  label,
  confirm: message,
}: {
  id: string;
  label: string;
  confirm: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    revokeApiKeyAction,
    {},
  );
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
      className="flex items-center gap-2"
    >
      <input type="hidden" name="id" value={id} />
      {state.error ? (
        <span className="text-xs text-danger">{state.error}</span>
      ) : null}
      <Button type="submit" variant="quiet" disabled={pending}>
        {label}
      </Button>
    </form>
  );
}
