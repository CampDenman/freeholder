// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";

import { useActionState } from "react";
import { Button, Field, Input, Select } from "@/ui/primitives";
import {
  connectRuntimeAction,
  createTaskAction,
  flagTaskAction,
  hireAgentAction,
  updateTaskAction,
  type WorkActionState,
} from "../../work-actions";

const empty: WorkActionState = {};

export function CreateTaskForm({
  agents,
  labels,
}: {
  agents: Array<{ id: string; name: string }>;
  labels: {
    title: string;
    brief: string;
    agent: string;
    unassigned: string;
    priority: string;
    due: string;
    submit: string;
    error: string;
  };
}) {
  const [state, action] = useActionState(createTaskAction, empty);
  return (
    <form action={action} className="grid gap-4">
      {state.error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {state.error}
        </p>
      ) : null}
      <Field htmlFor="title" label={labels.title}>
        <Input id="title" name="title" required maxLength={200} />
      </Field>
      <Field htmlFor="brief" label={labels.brief}>
        <textarea
          id="brief"
          name="brief"
          rows={3}
          maxLength={50_000}
          className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field htmlFor="agentId" label={labels.agent}>
          <Select id="agentId" name="agentId" defaultValue="">
            <option value="">{labels.unassigned}</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field htmlFor="priority" label={labels.priority}>
          <Select id="priority" name="priority" defaultValue="3">
            {[1, 2, 3, 4, 5].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
        <Field htmlFor="dueAt" label={labels.due}>
          <Input id="dueAt" name="dueAt" type="datetime-local" />
        </Field>
      </div>
      <Button type="submit">{labels.submit}</Button>
    </form>
  );
}

export function UpdateTaskForm({
  task,
  labels,
}: {
  task: { id: string; title: string; brief: string; priority: number; dueAt: Date | null };
  labels: {
    title: string;
    brief: string;
    priority: string;
    due: string;
    submit: string;
    error: string;
  };
}) {
  const [state, action] = useActionState(updateTaskAction, empty);
  const dueValue = task.dueAt
    ? new Date(task.dueAt.getTime() - task.dueAt.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16)
    : "";
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="id" value={task.id} />
      {state.error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {state.error}
        </p>
      ) : null}
      <Field htmlFor="title" label={labels.title}>
        <Input id="title" name="title" required maxLength={200} defaultValue={task.title} />
      </Field>
      <Field htmlFor="brief" label={labels.brief}>
        <textarea
          id="brief"
          name="brief"
          rows={4}
          maxLength={50_000}
          defaultValue={task.brief}
          className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field htmlFor="priority" label={labels.priority}>
          <Select id="priority" name="priority" defaultValue={String(task.priority)}>
            {[1, 2, 3, 4, 5].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
        <Field htmlFor="dueAt" label={labels.due}>
          <Input id="dueAt" name="dueAt" type="datetime-local" defaultValue={dueValue} />
        </Field>
      </div>
      <Button type="submit">{labels.submit}</Button>
    </form>
  );
}

export function FlagTaskForm({
  id,
  labels,
}: {
  id: string;
  labels: { reason: string; submit: string; error: string };
}) {
  const [state, action] = useActionState(flagTaskAction, empty);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="id" value={id} />
      {state.error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {state.error}
        </p>
      ) : null}
      <Field htmlFor="reason" label={labels.reason}>
        <Input id="reason" name="reason" required maxLength={500} />
      </Field>
      <Button type="submit">{labels.submit}</Button>
    </form>
  );
}

export function ConnectRuntimeForm({
  adapters,
  labels,
}: {
  adapters: readonly string[];
  labels: {
    name: string;
    kind: string;
    inbound: string;
    managed: string;
    adapter: string;
    model: string;
    credential: string;
    credentialHint: string;
    credentialPlaceholder: string;
    submit: string;
    noConnection?: string;
  };
}) {
  const [state, action] = useActionState(connectRuntimeAction, empty);
  return (
    <form action={action} className="grid gap-4">
      {state.error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {state.error}
        </p>
      ) : null}
      <Field htmlFor="runtime-name" label={labels.name}>
        <Input id="runtime-name" name="name" required maxLength={80} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field htmlFor="runtime-kind" label={labels.kind}>
          <Select id="runtime-kind" name="kind" defaultValue="inbound">
            <option value="inbound">{labels.inbound}</option>
            <option value="managed">{labels.managed}</option>
          </Select>
        </Field>
        <Field htmlFor="runtime-adapter" label={labels.adapter}>
          <Select id="runtime-adapter" name="adapter" defaultValue="">
            <option value="">—</option>
            {adapters.map((adapter) => (
              <option key={adapter} value={adapter}>
                {adapter}
              </option>
            ))}
          </Select>
        </Field>
        <Field htmlFor="runtime-model" label={labels.model}>
          <Input id="runtime-model" name="model" maxLength={120} />
        </Field>
        <Field htmlFor="runtime-credential" label={labels.credential} hint={labels.credentialHint}>
          <Input
            id="runtime-credential"
            name="credentialRef"
            maxLength={120}
            placeholder={labels.credentialPlaceholder}
            className="font-mono uppercase"
          />
        </Field>
      </div>
      <Button type="submit">{labels.submit}</Button>
    </form>
  );
}

export function HireAgentForm({
  connections,
  labels,
}: {
  connections: Array<{ id: string; name: string }>;
  labels: {
    name: string;
    role: string;
    connection: string;
    instructions: string;
    scopes: string;
    scopesHint: string;
    scopesPlaceholder: string;
    autonomy: string;
    suggest: string;
    approve: string;
    autonomous: string;
    submit: string;
    tokenShown: string;
    tokenHint: string;
    noConnection: string;
  };
}) {
  const [state, action] = useActionState(hireAgentAction, empty);
  if (connections.length === 0) {
    return <p className="text-sm text-ink-muted">{labels.noConnection}</p>;
  }
  return (
    <form action={action} className="grid gap-4">
      {state.error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {state.error}
        </p>
      ) : null}
      {state.token ? (
        <p role="status" className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          <span className="font-semibold">{labels.tokenShown}</span>
          <code className="mt-1 block overflow-x-auto font-mono text-xs text-ink">{state.token}</code>
          <span className="mt-1 block text-xs text-ink-muted">{labels.tokenHint}</span>
        </p>
      ) : null}
      <Field htmlFor="hire-name" label={labels.name}>
        <Input id="hire-name" name="name" required maxLength={80} />
      </Field>
      <Field htmlFor="hire-role" label={labels.role}>
        <Input id="hire-role" name="role" required maxLength={200} />
      </Field>
      <Field htmlFor="hire-connection" label={labels.connection}>
        <Select id="hire-connection" name="connectionId" required>
          {connections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field htmlFor="hire-instructions" label={labels.instructions}>
        <textarea
          id="hire-instructions"
          name="instructions"
          rows={3}
          maxLength={20_000}
          className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
        />
      </Field>
      <Field htmlFor="hire-scopes" label={labels.scopes} hint={labels.scopesHint}>
        <Input id="hire-scopes" name="toolScopes" placeholder={labels.scopesPlaceholder} />
      </Field>
      <Field htmlFor="hire-autonomy" label={labels.autonomy}>
        <Select id="hire-autonomy" name="autonomy" defaultValue="suggest">
          <option value="suggest">{labels.suggest}</option>
          <option value="approve">{labels.approve}</option>
          <option value="autonomous">{labels.autonomous}</option>
        </Select>
      </Field>
      <Button type="submit">{labels.submit}</Button>
    </form>
  );
}
