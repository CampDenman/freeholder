// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.14: recover original records without creating replacement rows.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasModuleAccess } from "@/core/service";
import { listNotes } from "@/core/notes/service";
import { listTasks } from "@/core/tasks/service";
import { listPages } from "@/modules/cms/service";
import { listForms } from "@/modules/forms/service";
import { listPopups } from "@/modules/popups/service";
import { listSegments } from "@/core/segments/service";
import { listViews } from "@/core/views/service";
import { Button, Card, CardBody, Field, Input } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { recoverRecordAction } from "../../trash-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Every family with reversible removal, in the order the tabs present them.
 * `module` gates the tab on that family's ordinary grant; saved views are
 * personal configuration, so any signed-in staff member gets their own tab.
 */
const KINDS: Array<{ kind: string; module: string | null }> = [
  { kind: "notes", module: "notes" },
  { kind: "tasks", module: "tasks" },
  { kind: "pages", module: "cms" },
  { kind: "forms", module: "forms" },
  { kind: "popups", module: "popups" },
  { kind: "segments", module: "segments" },
  { kind: "views", module: null },
];

export default async function RecordTrashPage({ searchParams }: {
  searchParams: Promise<{ kind?: string; offset?: string; saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor();
  const query = await searchParams;
  const t = await getT();
  const kinds = KINDS.filter(entry => entry.module === null || hasModuleAccess(actor, entry.module));
  const kind = kinds.find(entry => entry.kind === query.kind)?.kind ?? kinds[0]?.kind;
  if (!kind) notFound();
  const numericOffset = Number(query.offset ?? 0);
  const offset = Number.isSafeInteger(numericOffset) && numericOffset >= 0 && numericOffset <= 1_000_000 ? numericOffset : 0;
  const limit = 50;
  let records: Array<{ id: string; text: string }> = [];
  if (kind === "notes") {
    records = (await listNotes.call({ trashedOnly: true, limit, offset }, actor)).map(note => ({ id: note.id, text: note.body }));
  } else if (kind === "tasks") {
    records = (await listTasks.call({ trashedOnly: true, limit, offset }, actor)).map(task => ({ id: task.id, text: task.title }));
  } else if (kind === "pages") {
    records = (await listPages.call({ trashedOnly: true, limit, offset }, actor)).map(page => ({
      id: page.id,
      text: page.workingTitle?.trim() || page.title,
    }));
  } else if (kind === "forms") {
    records = (await listForms.call({ trashedOnly: true, limit, offset }, actor)).map(form => ({ id: form.id, text: form.name }));
  } else if (kind === "popups") {
    records = (await listPopups.call({ trashedOnly: true, limit, offset }, actor)).map(popup => ({ id: popup.id, text: popup.name }));
  } else if (kind === "segments") {
    records = (await listSegments.call({ trashedOnly: true, limit, offset }, actor)).map(segment => ({ id: segment.id, text: segment.name }));
  } else {
    records = (await listViews.call({ trashedOnly: true, limit, offset }, actor)).map(view => ({ id: view.id, text: view.name }));
  }
  const manageModule = KINDS.find(entry => entry.kind === kind)?.module ?? null;
  const canManage = manageModule === null || hasModuleAccess(actor, manageModule, "manage");
  const stepUp = actor.kind === "user" && Boolean(actor.security?.stepUpValid);
  return <div className="grid gap-6">
    <div>
      <h1 className="text-xl font-bold tracking-tight">{t("records.trash.title")}</h1>
      <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("records.trash.hint")}</p>
    </div>
    <nav className="flex flex-wrap gap-4" aria-label={t("records.trash.kinds")}>
      {kinds.map(entry => <a key={entry.kind} href={`/admin/trash?kind=${entry.kind}`} aria-current={kind === entry.kind ? "page" : undefined} className="underline">{t(`${entry.kind}.title`)}</a>)}
    </nav>
    {query.saved === "restored" || query.saved === "purged" ? <p role="status" className="text-success">{t(`records.trash.${query.saved}`)}</p> : null}
    {query.error ? <p role="alert" className="text-danger">{query.error}</p> : null}
    {!records.length ? <p className="text-ink-muted">{t("records.trash.empty")}</p> : <ul className="grid list-none gap-3 p-0">
      {records.map(record => <li key={record.id}>
        <Card><CardBody>
          <p className="whitespace-pre-wrap break-words text-sm">{record.text}</p>
          {canManage ? <div className="mt-3 grid gap-3">
            <form action={recoverRecordAction}>
              <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={record.id} />
              <input type="hidden" name="operation" value="restore" />
              <Button type="submit">{t("records.trash.restore")}</Button>
            </form>
            {stepUp ? <form action={recoverRecordAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={record.id} />
              <input type="hidden" name="operation" value="purge" />
              <Field label={t("records.trash.confirm")} htmlFor={`purge-${record.id}`}>
                <Input id={`purge-${record.id}`} name="confirmation" required pattern="PURGE" autoComplete="off" />
              </Field>
              <Button type="submit" variant="danger">{t("records.trash.purge")}</Button>
            </form> : <a className="text-sm underline" href={`/security/verify?returnTo=${encodeURIComponent(`/admin/trash?kind=${kind}`)}`}>{t("records.trash.verify")}</a>}
          </div> : null}
        </CardBody></Card>
      </li>)}
    </ul>}
    <nav className="flex gap-4" aria-label={t("records.trash.pages")}>
      {offset > 0 ? <a className="underline" href={`/admin/trash?kind=${kind}&offset=${Math.max(0, offset - limit)}`}>{t("records.trash.previous")}</a> : null}
      {records.length === limit && offset + limit <= 1_000_000 ? <a className="underline" href={`/admin/trash?kind=${kind}&offset=${offset + limit}`}>{t("records.trash.next")}</a> : null}
    </nav>
  </div>;
}
