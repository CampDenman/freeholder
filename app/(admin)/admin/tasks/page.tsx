// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The work list (C7.02, MASTER.md §4.14).
//
// §4.14: "A CRM that only stores contacts is an address book with extra steps.
// What makes one worth opening every morning is that it holds the *work*."
//
// So this page is a list, not a board. Three groups in the order somebody
// actually reads them — late, then dated, then sometime — and everything in a
// group carries where it came from, because "chase the deposit" means nothing
// without the invoice beside it.
//
// No JavaScript anywhere: every control is a small form. A phone on a bad
// connection is exactly where somebody ticks a task off.
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Pill, type Tone } from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { CADENCES, listTasks, TASK_PRIORITIES } from "@/core/tasks/service";
import { listRoleUsers } from "@/core/roles/service";
import { defaultView, meaningfulParams, toQueryString } from "@/core/views/service";
import { redirect } from "next/navigation";
import { ViewBar } from "../ViewBar";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import {
  assignTaskAction,
  createTaskAction,
  removeTaskAction,
  setTaskStatusAction,
} from "../../task-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const PRIORITY_TONES: Record<string, Tone> = {
  low: "neutral",
  normal: "neutral",
  high: "warning",
  urgent: "danger",
};

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; view?: string }>;
}) {
  const actor = await requireStaffActor("crm");
  const query = await searchParams;
  const mine = query.view === "mine";
  const applied = meaningfulParams(query);

  // Nothing asked for: open whatever this person keeps as their first screen,
  // by navigating to it (C7.06). Rendering it silently would leave the address
  // bar disagreeing with the page.
  if (Object.keys(applied).length === 0) {
    const preferred = await defaultView.call({ entity: "tasks" }, actor);
    const preset = preferred ? toQueryString(preferred.filters) : "";
    if (preset) redirect(`/admin/tasks?${preset}`);
  }
  const [t, business, open, staff] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(
      listTasks.call(
        {
          openOnly: true,
          ...(mine && actor.kind === "user" ? { assigneeUserId: actor.userId } : {}),
          limit: 200,
        },
        actor,
      ),
    ),
    domainOrNull(listRoleUsers.call({}, actor)),
  ]);

  const locale = business?.defaultLocale ?? "en";
  const day = (value: Date | string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value));

  const rows = open ?? [];
  const now = Date.now();
  // Three groups, in the order somebody reads them. Undated work is last on
  // purpose: a list that buries Friday's deadline under "sometime" is not a
  // work list.
  const late = rows.filter((task) => task.dueAt && new Date(task.dueAt).getTime() < now);
  const dated = rows.filter((task) => task.dueAt && new Date(task.dueAt).getTime() >= now);
  const undated = rows.filter((task) => !task.dueAt);

  const group = (title: string, items: typeof rows, tone: Tone) =>
    items.length === 0 ? null : (
      <Card key={title}>
        <CardHeader title={title} />
        <CardBody>
          <ul className="grid list-none gap-2 p-0">
            {items.map((task) => (
              <li
                key={task.id}
                className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
              >
                <form action={setTaskStatusAction}>
                  <input type="hidden" name="id" value={task.id} />
                  <input type="hidden" name="status" value="done" />
                  <Button type="submit" variant="quiet">
                    {t("tasks.action.done")}
                  </Button>
                </form>
                <span className="font-medium">{task.title}</span>
                {task.priority !== "normal" ? (
                  <Pill tone={PRIORITY_TONES[task.priority] ?? "neutral"}>
                    {t(`tasks.priority.${task.priority}`)}
                  </Pill>
                ) : null}
                {task.status !== "open" ? (
                  <Pill tone="neutral">{t(`tasks.status.${task.status}`)}</Pill>
                ) : null}
                {task.cadence ? (
                  <Pill tone="accent">{t(`tasks.cadence.${task.cadence}`)}</Pill>
                ) : null}
                {/* Where it came from. "Chase the deposit" means nothing
                    without the invoice next to it. */}
                {task.href && task.subjectType ? (
                  <a href={task.href} className="underline">
                    {t(`tasks.subject.${task.subjectType}`)}
                    {task.contactName ? ` · ${task.contactName}` : ""}
                  </a>
                ) : task.contactName ? (
                  <span className="text-ink-muted">{task.contactName}</span>
                ) : null}
                {task.dueAt ? (
                  <span className={tone === "danger" ? "text-danger" : "text-ink-muted"}>
                    {day(task.dueAt)}
                  </span>
                ) : null}
                <form action={assignTaskAction} className="ms-auto flex items-center gap-2">
                  <input type="hidden" name="id" value={task.id} />
                  <label className="sr-only" htmlFor={`assignee-${task.id}`}>
                    {t("tasks.field.assignee")}
                  </label>
                  <select
                    id={`assignee-${task.id}`}
                    name="assigneeUserId"
                    defaultValue={task.assigneeUserId ?? ""}
                    className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                  >
                    <option value="">{t("tasks.unassigned")}</option>
                    {(staff ?? []).map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.email}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" variant="quiet">
                    {t("tasks.action.assign")}
                  </Button>
                </form>
                <form action={setTaskStatusAction}>
                  <input type="hidden" name="id" value={task.id} />
                  <input
                    type="hidden"
                    name="status"
                    value={task.status === "blocked" ? "open" : "blocked"}
                  />
                  <Button type="submit" variant="quiet">
                    {task.status === "blocked"
                      ? t("tasks.action.unblock")
                      : t("tasks.action.block")}
                  </Button>
                </form>
                <form action={removeTaskAction}>
                  <input type="hidden" name="id" value={task.id} />
                  <Button type="submit" variant="quiet">
                    {t("tasks.action.remove")}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    );

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("tasks.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("tasks.intro")}</p>
        <p className="mt-2 flex flex-wrap gap-4 text-sm">
          <a href="/admin/tasks" className={mine ? "underline" : "font-medium"}>
            {t("tasks.view.all")}
          </a>
          <a href="/admin/tasks?view=mine" className={mine ? "font-medium" : "underline"}>
            {t("tasks.view.mine")}
          </a>
        </p>
      </div>

      {/* The same bar as every other list: a saved view here is a named URL
          exactly as it is on contacts (C7.06). */}
      <ViewBar actor={actor} entity="tasks" params={applied} />

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("tasks.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error.includes(" ") ? query.error : t("tasks.failed")}
        </p>
      ) : null}

      {open === null ? (
        <p className="text-sm text-danger">{t("tasks.unavailable")}</p>
      ) : rows.length === 0 ? (
        <Card>
          <CardBody>
            <p className="max-w-prose text-sm text-ink-muted">{t("tasks.empty")}</p>
          </CardBody>
        </Card>
      ) : (
        [
          group(t("tasks.group.late"), late, "danger"),
          group(t("tasks.group.dated"), dated, "neutral"),
          group(t("tasks.group.undated"), undated, "neutral"),
        ]
      )}

      <Card>
        <CardHeader title={t("tasks.add")} />
        <CardBody>
          <form action={createTaskAction} className="flex flex-wrap items-end gap-3">
            <label className="grid grow gap-1 text-sm">
              <span className="text-ink-muted">{t("tasks.field.title")}</span>
              <input
                name="title"
                required
                className="w-full rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("tasks.field.dueOn")}</span>
              <input
                type="date"
                name="dueOn"
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("tasks.field.remindOn")}</span>
              <input
                type="date"
                name="remindOn"
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("tasks.field.priority")}</span>
              <select
                name="priority"
                defaultValue="normal"
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              >
                {TASK_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {t(`tasks.priority.${priority}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("tasks.field.repeats")}</span>
              <select
                name="cadence"
                defaultValue=""
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              >
                <option value="">{t("tasks.cadence.never")}</option>
                {CADENCES.map((cadence) => (
                  <option key={cadence} value={cadence}>
                    {t(`tasks.cadence.${cadence}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("tasks.field.assignee")}</span>
              <select
                name="assigneeUserId"
                defaultValue=""
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              >
                <option value="">{t("tasks.unassigned")}</option>
                {(staff ?? []).map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.email}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit">{t("tasks.action.add")}</Button>
          </form>
          {/* Recurrence advances on completion, never on a clock. */}
          <p className="max-w-prose text-sm text-ink-muted">{t("tasks.addHint")}</p>
        </CardBody>
      </Card>
    </div>
  );
}
