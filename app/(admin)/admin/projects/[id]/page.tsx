// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One job, and everything attached to it (C6.15, MASTER.md §4.7).
//
// The attachments are links rather than embeds, deliberately: the invoice on
// this page *is* the invoice in the ledger, and clicking through gets the real
// thing rather than a summary that can drift from it.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Pill, type Tone } from "@/ui/primitives";
import { getProject } from "@/modules/projects/service";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { domainOrNull } from "../../../read-helpers";
import {
  addTaskAction,
  linkAction,
  removeTaskAction,
  setOutcomeAction,
  setTaskStatusAction,
  unlinkAction,
  updateProjectAction,
} from "../../../project-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const STATUS_TONES: Record<string, Tone> = {
  enquiry: "neutral",
  quoted: "warning",
  active: "accent",
  on_hold: "warning",
  complete: "success",
  cancelled: "neutral",
};

const TASK_TONES: Record<string, Tone> = {
  todo: "neutral",
  doing: "accent",
  blocked: "danger",
  done: "success",
};

const STATUSES = ["enquiry", "quoted", "active", "on_hold", "complete", "cancelled"];
const LINK_KINDS = ["quote", "contract", "booking", "invoice", "rental", "form_submission"];

/** Where each kind of attachment actually lives, so a link goes somewhere. */
const LINK_PATHS: Record<string, string> = {
  quote: "/admin/quotes",
  contract: "/admin/agreements",
  booking: "/admin/appointments",
  invoice: "/admin/invoices",
  rental: "/admin/hire",
};

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("projects");
  const { id } = await params;
  const [t, project, query] = await Promise.all([
    getT(),
    domainOrNull(getProject.call({ id }, actor)),
    searchParams,
  ]);
  if (!project) notFound();

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/projects" className="text-sm text-ink-muted">
          {t("projects.back")}
        </a>
        <h1 className="mt-2 flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight">
          {project.title}
          <Pill tone={STATUS_TONES[project.status] ?? "neutral"}>
            {t(`projects.status.${project.status}`)}
          </Pill>
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {project.contactName ?? project.clientDisplayName ?? t("projects.internal")}
        </p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("projects.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error.includes(" ") ? query.error : t("projects.failed")}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("projects.attached")} />
        <CardBody>
          {project.links.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("projects.nothingAttached")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {project.links.map((link) => (
                <li
                  key={link.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-2 text-sm"
                >
                  <Pill tone="neutral">{t(`projects.kind.${link.kind}`)}</Pill>
                  {LINK_PATHS[link.kind] ? (
                    <a
                      href={`${LINK_PATHS[link.kind]}/${link.targetId}`}
                      className="underline"
                    >
                      {link.label ?? t("projects.open")}
                    </a>
                  ) : (
                    <span>{link.label ?? link.targetId}</span>
                  )}
                  <form action={unlinkAction} className="ms-auto">
                    <input type="hidden" name="projectId" value={project.id} />
                    <input type="hidden" name="id" value={link.id} />
                    <Button type="submit" variant="quiet">
                      {t("projects.action.detach")}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={linkAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="projectId" value={project.id} />
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("projects.field.kind")}</span>
              <select
                name="kind"
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              >
                {LINK_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`projects.kind.${kind}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("projects.field.reference")}</span>
              <input
                name="targetId"
                required
                className="w-80 rounded-md border border-rule bg-field px-2 py-1 font-mono text-xs"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("projects.field.label")}</span>
              <input
                name="label"
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <Button type="submit" variant="quiet">
              {t("projects.action.attach")}
            </Button>
          </form>
          {/* Nothing here restates a total: the invoice on this page is the
              invoice in the ledger, and clicking through gets the real one. */}
          <p className="max-w-prose text-sm text-ink-muted">{t("projects.attachedHint")}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("projects.tasks")} />
        <CardBody>
          {project.tasks.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("projects.noTasks")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {project.tasks.map((task) => (
                <li
                  key={task.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-2 text-sm"
                >
                  <span>{task.title}</span>
                  <Pill tone={TASK_TONES[task.status] ?? "neutral"}>
                    {t(`projects.task.${task.status}`)}
                  </Pill>
                  {task.dueOn ? (
                    <span className="text-ink-muted tabular-nums">{task.dueOn}</span>
                  ) : null}
                  <form action={setTaskStatusAction} className="ms-auto flex items-end gap-2">
                    <input type="hidden" name="projectId" value={project.id} />
                    <input type="hidden" name="id" value={task.id} />
                    <select
                      name="status"
                      defaultValue={task.status}
                      className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                    >
                      {["todo", "doing", "blocked", "done"].map((status) => (
                        <option key={status} value={status}>
                          {t(`projects.task.${status}`)}
                        </option>
                      ))}
                    </select>
                    <Button type="submit" variant="quiet">
                      {t("projects.action.move")}
                    </Button>
                  </form>
                  <form action={removeTaskAction}>
                    <input type="hidden" name="projectId" value={project.id} />
                    <input type="hidden" name="id" value={task.id} />
                    <Button type="submit" variant="quiet">
                      {t("projects.action.removeTask")}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={addTaskAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="projectId" value={project.id} />
            <label className="grid grow gap-1 text-sm">
              <span className="text-ink-muted">{t("projects.field.task")}</span>
              <input
                name="title"
                required
                className="w-full rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("projects.field.due")}</span>
              <input
                type="date"
                name="dueOn"
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <Button type="submit" variant="quiet">
              {t("projects.action.addTask")}
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("projects.outcomes")} />
        <CardBody>
          {project.outcomes.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("projects.noOutcomes")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {project.outcomes.map((outcome) => (
                <li key={outcome.id} className="rounded-md border border-rule p-2 text-sm">
                  <span className="font-medium tabular-nums">
                    {outcome.value}
                    {outcome.unit ?? ""}
                  </span>{" "}
                  <span>{outcome.label}</span>
                  {outcome.method ? (
                    <p className="text-ink-muted">{outcome.method}</p>
                  ) : (
                    // §4.7: a claim nobody can substantiate is a claim the
                    // business is making up. Saying so here is what makes an
                    // owner notice before it reaches a case study.
                    <p className="text-warning">{t("projects.unmeasured")}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <form action={setOutcomeAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="projectId" value={project.id} />
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("projects.field.claim")}</span>
              <input
                name="label"
                required
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("projects.field.value")}</span>
              <input
                name="value"
                required
                className="w-24 rounded-md border border-rule bg-field px-2 py-1 text-sm tabular-nums"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("projects.field.unit")}</span>
              <input
                name="unit"
                className="w-20 rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="grid grow gap-1 text-sm">
              <span className="text-ink-muted">{t("projects.field.method")}</span>
              <input
                name="method"
                className="w-full rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <Button type="submit" variant="quiet">
              {t("projects.action.addOutcome")}
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("projects.details")} />
        <CardBody>
          <form action={updateProjectAction} className="grid gap-3">
            <input type="hidden" name="id" value={project.id} />
            <div className="flex flex-wrap items-end gap-3">
              <label className="grid gap-1 text-sm">
                <span className="text-ink-muted">{t("projects.field.title")}</span>
                <input
                  name="title"
                  defaultValue={project.title}
                  className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-ink-muted">{t("projects.field.status")}</span>
                <select
                  name="status"
                  defaultValue={project.status}
                  className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                >
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {t(`projects.status.${status}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-ink-muted">{t("projects.field.publicName")}</span>
                <input
                  name="clientDisplayName"
                  defaultValue={project.clientDisplayName ?? ""}
                  placeholder={t("projects.publicNamePlaceholder")}
                  className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-ink-muted">{t("projects.field.occurredOn")}</span>
                <input
                  type="date"
                  name="occurredOn"
                  defaultValue={project.occurredOn ?? ""}
                  className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                />
              </label>
            </div>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("projects.field.summary")}</span>
              <input
                name="summary"
                defaultValue={project.summary ?? ""}
                className="max-w-prose rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("projects.field.notes")}</span>
              <textarea
                name="notes"
                rows={4}
                defaultValue={project.notes ?? ""}
                className="max-w-prose rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <div>
              <Button type="submit" variant="quiet">
                {t("projects.action.save")}
              </Button>
            </div>
          </form>
          <p className="max-w-prose text-sm text-ink-muted">{t("projects.detailsHint")}</p>
        </CardBody>
      </Card>
    </div>
  );
}
