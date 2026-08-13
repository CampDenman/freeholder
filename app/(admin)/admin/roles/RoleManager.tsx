// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useActionState } from "react";
import {
  CheckCircle,
  ShieldCheck,
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
  Pill,
  Select,
} from "@/ui/primitives";
import {
  assignRoleAction,
  createRoleAction,
  deleteRoleAction,
  updateRoleAction,
  type ActionState,
} from "../../actions";

export interface RoleRow {
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  assignable: boolean;
  users: number;
  grants: Array<{ module: string; access: "view" | "manage" }>;
}

export interface RoleModule {
  module: string;
  queries: number;
  mutations: number;
}

export interface RoleAccount {
  id: string;
  email: string;
  role: string;
  lastLogin: string | null;
}

export interface RoleLabels {
  title: string;
  intro: string;
  builtIn: string;
  custom: string;
  assigned: string;
  name: string;
  description: string;
  access: string;
  accessHint: string;
  none: string;
  view: string;
  manage: string;
  allModules: string;
  save: string;
  saving: string;
  saved: string;
  remove: string;
  removeConfirm: string;
  createTitle: string;
  create: string;
  accountsTitle: string;
  account: string;
  role: string;
  lastLogin: string;
  never: string;
  assign: string;
  readOnly: string;
}

function currentAccess(role: RoleRow, module: string): string {
  return role.grants.find((grant) => grant.module === module)?.access ?? "none";
}

function ModuleChoices({
  modules,
  role,
  labels,
  disabled = false,
}: {
  modules: RoleModule[];
  role?: RoleRow;
  labels: RoleLabels;
  disabled?: boolean;
}) {
  return (
    <fieldset className="grid gap-2 border-0 p-0">
      <legend className="mb-1 text-sm font-semibold text-ink">
        {labels.access}
      </legend>
      <p className="mb-2 text-xs text-ink-muted">{labels.accessHint}</p>
      {modules.map((area) => (
        <div
          key={area.module}
          className="grid items-center gap-2 sm:grid-cols-[12rem_1fr]"
        >
          <label
            htmlFor={`${role?.key ?? "new"}-grant-${area.module}`}
            className="font-mono text-xs text-ink-muted"
          >
            {area.module === "*" ? labels.allModules : area.module}
          </label>
          <Select
            id={`${role?.key ?? "new"}-grant-${area.module}`}
            name={`grant-${area.module}`}
            defaultValue={role ? currentAccess(role, area.module) : "none"}
            disabled={disabled}
          >
            <option value="none">{labels.none}</option>
            {area.queries > 0 ? <option value="view">{labels.view}</option> : null}
            <option value="manage">{labels.manage}</option>
          </Select>
        </div>
      ))}
    </fieldset>
  );
}

function RoleEditor({
  role,
  modules,
  labels,
}: {
  role: RoleRow;
  modules: RoleModule[];
  labels: RoleLabels;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    updateRoleAction,
    {},
  );
  const [deleteState, deleteAction, deleting] = useActionState<
    ActionState,
    FormData
  >(deleteRoleAction, {});

  return (
    <Card>
      <CardHeader
        icon={<ShieldCheck size={17} weight="fill" />}
        title={role.name}
        status={
          <span className="flex flex-wrap gap-2">
            <Pill tone={role.isSystem ? "accent" : "neutral"}>
              {role.isSystem ? labels.builtIn : labels.custom}
            </Pill>
            <Pill tone="neutral">
              {role.users} {labels.assigned}
            </Pill>
          </span>
        }
      />
      <form action={action}>
        <CardBody>
          <input type="hidden" name="key" value={role.key} />
          {state.error || deleteState.error ? (
            <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
              {state.error ?? deleteState.error}
            </Callout>
          ) : null}
          {state.saved ? (
            <Callout tone="success" icon={<CheckCircle size={17} weight="fill" />}>
              {labels.saved}
            </Callout>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={labels.name} htmlFor={`${role.key}-name`}>
              <Input
                id={`${role.key}-name`}
                name="name"
                defaultValue={role.name}
                required
                maxLength={80}
              />
            </Field>
            <Field
              label={labels.description}
              htmlFor={`${role.key}-description`}
            >
              <Input
                id={`${role.key}-description`}
                name="description"
                defaultValue={role.description}
                maxLength={500}
              />
            </Field>
          </div>
          <ModuleChoices modules={modules} role={role} labels={labels} />
        </CardBody>
        <CardFooter>
          <Button type="submit" disabled={pending}>
            {pending ? labels.saving : labels.save}
          </Button>
        </CardFooter>
      </form>
      {!role.isSystem ? (
        <form
          action={deleteAction}
          onSubmit={(event) => {
            if (!window.confirm(labels.removeConfirm)) event.preventDefault();
          }}
        >
          <input type="hidden" name="key" value={role.key} />
          <div className="flex justify-end border-t border-rule px-4 py-3">
            <Button type="submit" variant="danger" disabled={deleting}>
              <Trash size={15} />
              {labels.remove}
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}

function NewRole({
  modules,
  labels,
}: {
  modules: RoleModule[];
  labels: RoleLabels;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    createRoleAction,
    {},
  );
  return (
    <Card>
      <CardHeader title={labels.createTitle} />
      <form action={action}>
        <CardBody>
          {state.error ? (
            <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
              {state.error}
            </Callout>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={labels.name} htmlFor="new-role-name">
              <Input id="new-role-name" name="name" required maxLength={80} />
            </Field>
            <Field label={labels.description} htmlFor="new-role-description">
              <Input id="new-role-description" name="description" maxLength={500} />
            </Field>
          </div>
          <ModuleChoices modules={modules} labels={labels} />
        </CardBody>
        <CardFooter>
          <Button type="submit" disabled={pending}>
            {pending ? labels.saving : labels.create}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function AccountAssignment({
  account,
  roles,
  labels,
}: {
  account: RoleAccount;
  roles: RoleRow[];
  labels: RoleLabels;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    assignRoleAction,
    {},
  );
  const owner = account.role === "owner";
  return (
    <li className="grid gap-2 border-b border-rule py-3 last:border-0 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
      <div>
        <span className="block font-medium text-ink">{account.email}</span>
        <span className="text-xs text-ink-muted">
          {labels.lastLogin}: {account.lastLogin ?? labels.never}
        </span>
        {state.error ? <span className="block text-xs text-danger">{state.error}</span> : null}
      </div>
      <form action={action} className="contents">
        <input type="hidden" name="userId" value={account.id} />
        <Field label={labels.role} htmlFor={`account-${account.id}-role`}>
          <Select
            id={`account-${account.id}-role`}
            name="roleKey"
            defaultValue={account.role}
            disabled={owner || pending}
          >
            {roles
              .filter((role) => role.assignable || role.key === account.role)
              .map((role) => (
                <option key={role.key} value={role.key}>
                  {role.name}
                </option>
              ))}
          </Select>
        </Field>
        <Button type="submit" disabled={owner || pending}>
          {labels.assign}
        </Button>
      </form>
    </li>
  );
}

export function RoleManager({
  roles,
  modules,
  accounts,
  labels,
  canManage,
}: {
  roles: RoleRow[];
  modules: RoleModule[];
  accounts: RoleAccount[];
  labels: RoleLabels;
  canManage: boolean;
}) {
  return (
    <div className="grid gap-6">
      {!canManage ? <Callout>{labels.readOnly}</Callout> : null}
      {canManage ? <NewRole modules={modules} labels={labels} /> : null}
      <div className="grid gap-4">
        {roles.map((role) =>
          canManage ? (
            <RoleEditor key={role.key} role={role} modules={modules} labels={labels} />
          ) : (
            <Card key={role.key}>
              <CardHeader title={role.name} />
              <CardBody>
                <p className="text-sm text-ink-muted">{role.description}</p>
                <div className="flex flex-wrap gap-2">
                  {role.grants.map((grant) => (
                    <Pill key={grant.module} tone="accent">
                      {grant.module}: {grant.access}
                    </Pill>
                  ))}
                </div>
              </CardBody>
            </Card>
          ),
        )}
      </div>
      <Card>
        <CardHeader title={labels.accountsTitle} />
        <CardBody>
          <ul className="list-none p-0">
            {accounts.map((account) =>
              canManage ? (
                <AccountAssignment
                  key={account.id}
                  account={account}
                  roles={roles}
                  labels={labels}
                />
              ) : (
                <li key={account.id} className="flex justify-between border-b border-rule py-2 last:border-0">
                  <span>{account.email}</span>
                  <Pill>{account.role}</Pill>
                </li>
              ),
            )}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
