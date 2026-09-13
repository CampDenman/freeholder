// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";

import { useActionState } from "react";
import { Button, Field, Input, Select } from "@/ui/primitives";
import {
  addPluginRegistryAction,
  disablePluginAction,
  enablePluginAction,
  installPluginAction,
  rollbackPluginAction,
  uninstallPluginAction,
  updatePluginAction,
  type PluginActionState,
} from "../../plugin-actions";

const empty: PluginActionState = {};

export function InstallPluginForm({
  labels,
}: {
  labels: { path: string; submit: string; error: string };
}) {
  const [state, action] = useActionState(installPluginAction, empty);
  return (
    <form action={action} className="grid gap-4">
      {state.error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {state.error}
        </p>
      ) : null}
      <Field htmlFor="path" label={labels.path}>
        <Input id="path" name="path" required />
      </Field>
      <Button type="submit">{labels.submit}</Button>
    </form>
  );
}

export function PluginRowActions({
  name,
  status,
  source,
  previousVersion,
  labels,
}: {
  name: string;
  status: string;
  source: string;
  previousVersion: string | null;
  labels: {
    enable: string;
    disable: string;
    uninstall: string;
    keep: string;
    purge: string;
    update: string;
    path: string;
    rollback: string;
    rollbackUnavailable: string;
    error: string;
  };
}) {
  const [updateState, updateAction] = useActionState(updatePluginAction, empty);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {status === "enabled" ? (
          <form action={disablePluginAction}>
            <input type="hidden" name="name" value={name} />
            <Button type="submit">{labels.disable}</Button>
          </form>
        ) : (
          <form action={enablePluginAction}>
            <input type="hidden" name="name" value={name} />
            <Button type="submit">{labels.enable}</Button>
          </form>
        )}
        <form action={uninstallPluginAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="name" value={name} />
          <Select name="retention" defaultValue="keep" aria-label={labels.keep}>
            <option value="keep">{labels.keep}</option>
            <option value="purge">{labels.purge}</option>
          </Select>
          <Button type="submit">{labels.uninstall}</Button>
        </form>
        {previousVersion ? (
          <form action={rollbackPluginAction}>
            <input type="hidden" name="name" value={name} />
            <Button type="submit" variant="quiet">
              {labels.rollback}
            </Button>
          </form>
        ) : (
          <p className="self-center text-xs text-ink-muted">{labels.rollbackUnavailable}</p>
        )}
      </div>
      <form action={updateAction} className="flex flex-wrap items-end gap-2">
        {updateState.error ? (
          <p role="alert" className="w-full text-sm font-medium text-danger">
            {updateState.error}
          </p>
        ) : null}
        <Field htmlFor={`update-path-${name}`} label={labels.path}>
          <Input id={`update-path-${name}`} name="path" required defaultValue={source} />
        </Field>
        <Button type="submit" variant="quiet">
          {labels.update}
        </Button>
      </form>
    </div>
  );
}

export function AddRegistryForm({
  labels,
}: {
  labels: {
    name: string;
    url: string;
    tier: string;
    submit: string;
    error: string;
    verified: string;
    community: string;
    private: string;
    local: string;
  };
}) {
  const [state, action] = useActionState(addPluginRegistryAction, empty);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      {state.error ? (
        <p role="alert" className="sm:col-span-2 text-sm font-medium text-danger">
          {state.error}
        </p>
      ) : null}
      <Field htmlFor="registry-name" label={labels.name}>
        <Input id="registry-name" name="name" required maxLength={80} />
      </Field>
      <Field htmlFor="registry-url" label={labels.url}>
        <Input id="registry-url" name="url" type="url" required />
      </Field>
      <Field htmlFor="registry-tier" label={labels.tier}>
        <Select id="registry-tier" name="tier" defaultValue="community">
          <option value="verified">{labels.verified}</option>
          <option value="community">{labels.community}</option>
          <option value="private">{labels.private}</option>
          <option value="local">{labels.local}</option>
        </Select>
      </Field>
      <div className="self-end">
        <Button type="submit">{labels.submit}</Button>
      </div>
    </form>
  );
}
