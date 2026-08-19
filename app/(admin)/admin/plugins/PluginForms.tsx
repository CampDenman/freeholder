// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";

import { useActionState } from "react";
import { Button, Field, Input, Select } from "@/ui/primitives";
import {
  disablePluginAction,
  enablePluginAction,
  installPluginAction,
  uninstallPluginAction,
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
  labels,
}: {
  name: string;
  status: string;
  labels: { enable: string; disable: string; uninstall: string; keep: string; purge: string };
}) {
  return (
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
    </div>
  );
}
