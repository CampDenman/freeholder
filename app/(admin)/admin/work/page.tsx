// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { formatDateTime } from "@/core/i18n";
import { currentBusiness } from "@/core/settings/read";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { BOARD_COLUMNS, listAgents, listBoard } from "@/core/agents/service";
import { listApprovals } from "@/core/agents/writes";
import { CreateTaskForm } from "./WorkForms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function WorkBoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireStaffActor("agents");
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  const agentId = one("agentId") || undefined;
  const unassigned = one("unassigned") === "1";
  const minPriority = one("minPriority") ? Number(one("minPriority")) : undefined;
  const [t, business, agents, pendingApprovals, columns] = await Promise.all([
    getT(),
    currentBusiness(),
    listAgents.call({}, actor),
    listApprovals.call({ status: "pending", limit: 200 }, actor),
    listBoard.call(
      {
        agentId,
        unassigned: unassigned || undefined,
        minPriority: minPriority && minPriority >= 1 && minPriority <= 5 ? minPriority : undefined,
      },
      actor,
    ),
  ]);
  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";

  return (
    <div className="grid gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight">{t("work.title")}</h1>
          <Link
            href="/admin/work/approvals"
            className="inline-flex items-center gap-2 rounded-md border border-rule px-3 py-1.5 text-sm font-semibold text-ink"
          >
            {t("work.approvals")}
            {pendingApprovals.length > 0 ? (
              <Pill tone="warning">{pendingApprovals.length}</Pill>
            ) : null}
          </Link>
        </div>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("work.intro")}</p>
      </div>

      <Card>
        <CardHeader title={t("work.filter")} />
        <CardBody>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("work.agent")}</span>
              <select
                name="agentId"
                defaultValue={agentId ?? ""}
                className="rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
              >
                <option value="">{t("work.filter.anyAgent")}</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("work.priority")}</span>
              <select
                name="minPriority"
                defaultValue={minPriority ? String(minPriority) : ""}
                className="rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
              >
                <option value="">{t("work.filter.anyPriority")}</option>
                {[1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={value}>
                    {value}+
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="unassigned" value="1" defaultChecked={unassigned} />
              {t("work.filter.unassigned")}
            </label>
            <button type="submit" className="rounded-md border border-rule px-3 py-2 text-sm">
              {t("work.filter.apply")}
            </button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("work.create")} />
        <CardBody>
          <CreateTaskForm
            agents={agents}
            labels={{
              title: t("work.field.title"),
              brief: t("work.field.brief"),
              agent: t("work.agent"),
              unassigned: t("work.unassigned"),
              priority: t("work.priority"),
              due: t("work.due"),
              submit: t("work.create"),
              error: t("work.error"),
            }}
          />
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-5">
        {BOARD_COLUMNS.map((column) => {
          const group = columns.find((item) => item.column === column);
          return (
            <section key={column} className="grid gap-2">
              <h2 className="text-sm font-semibold text-ink">
                {t(`work.column.${column}`)}{" "}
                <span className="font-mono text-ink-muted">{group?.tasks.length ?? 0}</span>
              </h2>
              <ul className="grid list-none gap-2 p-0">
                {(group?.tasks ?? []).length === 0 ? (
                  <li className="rounded-md border border-dashed border-rule px-3 py-4 text-sm text-ink-muted">
                    {t("work.emptyColumn")}
                  </li>
                ) : (
                  group!.tasks.map((task) => (
                    <li key={task.id}>
                      <Link
                        href={`/admin/work/${task.id}`}
                        className="grid gap-1 rounded-md border border-rule bg-surface px-3 py-2 text-sm text-ink"
                      >
                        <span className="font-medium">{task.title}</span>
                        <span className="flex flex-wrap gap-2">
                          <Pill tone={task.status === "needs_attention" || task.status === "failed" ? "warning" : "neutral"}>
                            {t(`work.status.${task.status}`)}
                          </Pill>
                          <Pill tone="neutral">{t("work.priorityValue", { value: task.priority })}</Pill>
                        </span>
                        {task.dueAt ? (
                          <span className="text-xs text-ink-muted">
                            {t("work.dueOn", {
                              when: formatDateTime(task.dueAt, timezone, locale),
                            })}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  ))
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
