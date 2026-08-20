// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Playbooks: reusable briefs and what starts them (C4.08, MASTER.md §40).
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { listPlaybooks } from "@/core/agents/playbooks";
import { parseParamsSchema } from "@/core/agents/playbook-params";
import {
  deletePlaybookAction,
  runPlaybookAction,
  togglePlaybookAction,
} from "../../../playbook-actions";
import { PlaybookForms } from "./PlaybookForms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PlaybooksPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("agents");
  const [t, playbooks, query] = await Promise.all([
    getT(),
    listPlaybooks.call({}, actor),
    searchParams,
  ]);

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/work" className="text-sm text-ink-muted">{t("work.playbooks.back")}</a>
        <h1 className="mt-2 text-xl font-bold tracking-tight">{t("work.playbooks.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("work.playbooks.intro")}</p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("work.playbooks.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {t("work.playbooks.failed")}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("work.playbooks.yours")} />
        <CardBody>
          {playbooks.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("work.playbooks.empty")}</p>
          ) : (
            <ul className="grid list-none gap-4 p-0">
              {playbooks.map((playbook) => {
                const params = parseParamsSchema(playbook.paramsSchema);
                return (
                  <li key={playbook.id} className="grid gap-3 rounded-md border border-rule px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{playbook.name}</span>
                      <Pill tone={playbook.enabled ? "success" : "neutral"}>
                        {t(`work.playbooks.${playbook.enabled ? "on" : "off"}`)}
                      </Pill>
                      <Pill>{t(`work.playbooks.trigger.${playbook.trigger}`)}</Pill>
                      <span className="font-mono text-xs text-ink-muted">
                        {t("work.playbooks.version", { version: playbook.version })}
                      </span>
                      {playbook.autonomyCeiling ? (
                        <Pill tone="warning">
                          {t(`work.approval.mode.${playbook.autonomyCeiling}`)}
                        </Pill>
                      ) : null}
                    </div>
                    {playbook.description ? (
                      <p className="text-sm text-ink-muted">{playbook.description}</p>
                    ) : null}
                    <pre className="overflow-x-auto rounded-md bg-surface-muted p-3 font-mono text-xs text-ink-muted">
                      {playbook.briefTemplate}
                    </pre>
                    {playbook.trigger === "schedule" && playbook.scheduleCron ? (
                      <p className="font-mono text-xs text-ink-muted">
                        {playbook.scheduleCron} — {t("work.playbooks.scheduleLater")}
                      </p>
                    ) : null}
                    {playbook.trigger === "event" && playbook.eventPattern ? (
                      <p className="font-mono text-xs text-ink-muted">{playbook.eventPattern}</p>
                    ) : null}

                    <div className="flex flex-wrap items-end gap-3">
                      {playbook.trigger === "manual" ? (
                        <form action={runPlaybookAction} className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="id" value={playbook.id} />
                          {params.map((param) => (
                            <label key={param.name} className="grid gap-1 text-sm">
                              <span className="text-ink-muted">{param.label}</span>
                              {param.type === "choice" ? (
                                <select
                                  name={`param.${param.name}`}
                                  required={param.required}
                                  className="rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
                                >
                                  {param.choices.map((choice) => (
                                    <option key={choice} value={choice}>
                                      {choice}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  name={`param.${param.name}`}
                                  required={param.required}
                                  type={param.type === "number" ? "number" : "text"}
                                  className="rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
                                />
                              )}
                            </label>
                          ))}
                          <Button type="submit">{t("work.playbooks.run")}</Button>
                        </form>
                      ) : null}
                      <form action={togglePlaybookAction} className="ms-auto">
                        <input type="hidden" name="id" value={playbook.id} />
                        <input
                          type="hidden"
                          name="enabled"
                          value={playbook.enabled ? "false" : "true"}
                        />
                        <Button type="submit" variant="quiet">
                          {t(`work.playbooks.${playbook.enabled ? "turnOff" : "turnOn"}`)}
                        </Button>
                      </form>
                      <form action={deletePlaybookAction}>
                        <input type="hidden" name="id" value={playbook.id} />
                        <Button type="submit" variant="danger">
                          {t("work.playbooks.delete")}
                        </Button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <PlaybookForms
        labels={{
          create: t("work.playbooks.create"),
          name: t("work.playbooks.field.name"),
          description: t("work.playbooks.field.description"),
          brief: t("work.playbooks.field.brief"),
          briefHint: t("work.playbooks.field.briefHint"),
          params: t("work.playbooks.field.params"),
          paramsHint: t("work.playbooks.field.paramsHint"),
          trigger: t("work.playbooks.field.trigger"),
          triggerManual: t("work.playbooks.trigger.manual"),
          triggerSchedule: t("work.playbooks.trigger.schedule"),
          triggerEvent: t("work.playbooks.trigger.event"),
          cron: t("work.playbooks.field.cron"),
          event: t("work.playbooks.field.event"),
          ceiling: t("work.playbooks.field.ceiling"),
          ceilingNone: t("work.playbooks.field.ceilingNone"),
          budget: t("work.playbooks.field.budget"),
          submit: t("work.playbooks.save"),
          importTitle: t("work.playbooks.import"),
          importHint: t("work.playbooks.importHint"),
          document: t("work.playbooks.field.document"),
          importName: t("work.playbooks.field.importName"),
          importSubmit: t("work.playbooks.importSubmit"),
          suggest: t("work.approval.mode.suggest"),
          approve: t("work.approval.mode.approve"),
          autonomous: t("work.approval.mode.autonomous"),
        }}
      />
    </div>
  );
}
