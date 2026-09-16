// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.14: recover original notes and tasks without creating replacement rows.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasModuleAccess } from "@/core/service";
import { listNotes } from "@/core/notes/service";
import { listTasks } from "@/core/tasks/service";
import { Button, Card, CardBody, Field, Input } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { recoverRecordAction } from "../../trash-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function RecordTrashPage({ searchParams }: {
  searchParams: Promise<{ kind?: string; offset?: string; saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor();
  const query = await searchParams;
  const t = await getT();
  const kinds = (["notes", "tasks"] as const).filter(kind => hasModuleAccess(actor, kind));
  const kind = kinds.find(value => value === query.kind) ?? kinds[0];
  if (!kind) notFound();
  const numericOffset = Number(query.offset ?? 0);
  const offset = Number.isSafeInteger(numericOffset) && numericOffset >= 0 && numericOffset <= 1_000_000 ? numericOffset : 0;
  const limit = 50;
  const records = kind === "notes"
    ? (await listNotes.call({ trashedOnly: true, limit, offset }, actor)).map(note => ({ id: note.id, text: note.body }))
    : (await listTasks.call({ trashedOnly: true, limit, offset }, actor)).map(task => ({ id: task.id, text: task.title }));
  const canManage = hasModuleAccess(actor, kind, "manage");
  const stepUp = actor.kind === "user" && Boolean(actor.security?.stepUpValid);
  return <div className="grid gap-6">
    <div>
      <h1 className="text-xl font-bold tracking-tight">{t("records.trash.title")}</h1>
      <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("records.trash.hint")}</p>
    </div>
    <nav className="flex flex-wrap gap-4" aria-label={t("records.trash.kinds")}>
      {kinds.map(value => <a key={value} href={`/admin/trash?kind=${value}`} aria-current={kind === value ? "page" : undefined} className="underline">{t(`${value}.title`)}</a>)}
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
