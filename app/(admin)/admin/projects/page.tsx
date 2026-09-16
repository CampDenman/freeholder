// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Work in hand (C6.15, MASTER.md §4.7).
//
// Ordered by what is live rather than by date, and each row carries how many
// tasks are still open — the one number that says whether a job is moving.
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Pill, type Tone } from "@/ui/primitives";
import { listContacts } from "@/core/contacts/service";
import { listProjects } from "@/modules/projects/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import { createProjectAction } from "../../project-actions";

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

/** Live work first; finished and abandoned jobs are history. */
const ORDER = ["active", "quoted", "enquiry", "on_hold", "complete", "cancelled"];

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("projects");
  const [t, projects, people, query] = await Promise.all([
    getT(),
    domainOrNull(listProjects.call({ limit: 100 }, actor)),
    domainOrNull(listContacts.call({ limit: 100 }, actor)),
    searchParams,
  ]);

  const sorted = [...(projects ?? [])].sort(
    (a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status),
  );

  return (
    <div className="grid gap-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold tracking-tight">{t("projects.title")}</h1>
          <a
            href="/admin/projects/collections"
            className="rounded-md border border-rule px-4 py-2 text-sm font-semibold text-ink"
          >
            {t("projects.collections.manage")}
          </a>
        </div>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("projects.intro")}</p>
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
        <CardHeader title={t("projects.inHand")} />
        <CardBody>
          {projects === null ? (
            <p className="text-sm text-danger">{t("projects.unavailable")}</p>
          ) : sorted.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("projects.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {sorted.map((project) => (
                <li
                  key={project.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                >
                  <a
                    href={`/admin/projects/${project.id}`}
                    className="font-medium underline"
                  >
                    {project.title}
                  </a>
                  <Pill tone={STATUS_TONES[project.status] ?? "neutral"}>
                    {t(`projects.status.${project.status}`)}
                  </Pill>
                  <span className="text-ink-muted">
                    {project.contactName ??
                      project.clientDisplayName ??
                      t("projects.internal")}
                  </span>
                  {project.openTasks > 0 ? (
                    <span className="ms-auto tabular-nums text-ink-muted">
                      {t("projects.openTasks", { count: String(project.openTasks) })}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("projects.start")} />
        <CardBody>
          <form action={createProjectAction} className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("projects.field.title")}</span>
              <input
                name="title"
                required
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("projects.field.client")}</span>
              <select
                name="contactId"
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              >
                {/* Internal work is real work, so "nobody" is a first-class
                    option rather than a workaround. */}
                <option value="">{t("projects.internal")}</option>
                {(people?.rows ?? []).map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("projects.field.summary")}</span>
              <input
                name="summary"
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <Button type="submit">{t("projects.action.start")}</Button>
          </form>
          <p className="max-w-prose text-sm text-ink-muted">{t("projects.startHint")}</p>
        </CardBody>
      </Card>
    </div>
  );
}
