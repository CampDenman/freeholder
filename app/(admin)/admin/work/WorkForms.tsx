// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";

import { useActionState } from "react";
import { Button, Field, Input, Select } from "@/ui/primitives";
import {
  createTaskAction,
  flagTaskAction,
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
