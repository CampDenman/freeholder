// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { formatDateTime } from "@/core/i18n";
import { currentBusiness } from "@/core/settings/read";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { getTask, listAgents, listTasks } from "@/core/agents/service";
import { FlagTaskForm, UpdateTaskForm } from "../WorkForms";
import { LiveRun } from "../LiveRun";
import {
  assignTaskAction,
  cancelTaskAction,
  reopenTaskAction,
  retryTaskAction,
} from "../../../work-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function WorkTaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireStaffActor("agents");
  const [t, business, task, agents] = await Promise.all([
    getT(),
    currentBusiness(),
    getTask.call({ id }, actor),
    listAgents.call({}, actor),
  ]);
  if (!task) notFound();

  const tree = await listTasks.call({ rootId: task.rootId, includeCancelled: true, limit: 200 }, actor);
  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";
  const parked = ["needs_attention", "failed", "blocked", "cancelled"].includes(task.status);
  const finished = task.status === "done" || task.status === "cancelled";
  const canRetry = ["needs_attention", "failed", "cancelled", "blocked", "queued"].includes(
    task.status,
  );
  const dependsOn = tree.filter((item) => task.dependsOn.includes(item.id));
  const latestRun = task.runs.at(-1);

  return (
    <div className="grid gap-6">
      <div>
        <Link href="/admin/work" className="text-sm text-ink-muted">
          {t("work.back")}
        </Link>
        <h1 className="mt-2 text-xl font-bold tracking-tight">{task.title}</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          <Pill tone={parked ? "warning" : task.status === "done" ? "success" : "neutral"}>
            {t(`work.status.${task.status}`)}
          </Pill>
          <Pill tone="neutral">{t("work.priorityValue", { value: task.priority })}</Pill>
        </div>
        {task.failureReason ? (
          <p className="mt-2 max-w-prose text-sm text-danger">{task.failureReason}</p>
        ) : null}
      </div>

      <Card>
        <CardHeader title={t("work.tree")} />
        <CardBody>
          <ul className="grid list-none gap-2 p-0">
            {tree.map((item) => (
              <li key={item.id} className={item.parentId ? "ms-6" : ""}>
                <Link href={`/admin/work/${item.id}`} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{item.title}</span>
                  <Pill tone="neutral">{t(`work.status.${item.status}`)}</Pill>
                  {item.dependsOn.length > 0 ? (
                    <span className="text-xs text-ink-muted">
                      {t("work.dependsCount", { count: item.dependsOn.length })}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {dependsOn.length > 0 ? (
        <Card>
          <CardHeader title={t("work.dependsOn")} />
          <CardBody>
            <ul className="grid list-none gap-2 p-0">
              {dependsOn.map((item) => (
                <li key={item.id}>
                  <Link href={`/admin/work/${item.id}`} className="text-sm">
                    {item.title} — {t(`work.status.${item.status}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {latestRun ? (
        <Card>
          <CardHeader
            title={t("work.run")}
            status={
              <Pill tone="neutral">
                {t("work.run.attempt", { value: latestRun.attempt })} · {latestRun.costCents}¢
              </Pill>
            }
          />
          <CardBody>
            <LiveRun
              runId={latestRun.id}
              live={latestRun.status === "running"}
              initialSteps={task.steps.filter((step) => step.runId === latestRun.id)}
              labels={{
                live: t("work.run.live"),
                stopped: t("work.run.stopped"),
                stop: t("work.stop"),
                empty: t("work.run.empty"),
                tokens: t("work.run.tokens"),
                step: {
                  message: t("work.step.message"),
                  tool_call: t("work.step.tool_call"),
                  tool_result: t("work.step.tool_result"),
                  note: t("work.step.note"),
                },
              }}
            />
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t("work.assign")} />
        <CardBody>
          <form action={assignTaskAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={task.id} />
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("work.agent")}</span>
              <select
                name="agentId"
                defaultValue={task.agentId ?? ""}
                className="rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
              >
                <option value="">{t("work.unassigned")}</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit">{t("work.assign")}</Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("work.edit")} />
        <CardBody>
          <UpdateTaskForm
            task={task}
            labels={{
              title: t("work.field.title"),
              brief: t("work.field.brief"),
              priority: t("work.priority"),
              due: t("work.due"),
              submit: t("work.save"),
              error: t("work.error"),
            }}
          />
          {task.dueAt ? (
            <p className="mt-3 text-sm text-ink-muted">
              {t("work.dueOn", { when: formatDateTime(task.dueAt, timezone, locale) })}
            </p>
          ) : null}
        </CardBody>
      </Card>

      {!finished ? (
        <Card>
          <CardHeader title={t("work.attention")} />
          <CardBody>
            <div className="grid gap-4">
              {canRetry && task.status !== "queued" ? (
                <form action={retryTaskAction}>
                  <input type="hidden" name="id" value={task.id} />
                  <Button type="submit">{t("work.retry")}</Button>
                </form>
              ) : null}
              {parked ? (
                <form action={reopenTaskAction}>
                  <input type="hidden" name="id" value={task.id} />
                  <Button type="submit">{t("work.reopen")}</Button>
                </form>
              ) : (
                <FlagTaskForm
                  id={task.id}
                  labels={{
                    reason: t("work.reason"),
                    submit: t("work.flag"),
                    error: t("work.error"),
                  }}
                />
              )}
              <form action={cancelTaskAction} className="grid gap-3">
                <input type="hidden" name="id" value={task.id} />
                <input type="hidden" name="reason" value="" />
                <Button type="submit" variant="danger">
                  {t("work.cancel")}
                </Button>
              </form>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
