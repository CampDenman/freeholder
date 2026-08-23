// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Notes against one thing (C7.03, MASTER.md §4.14).
//
// One component rather than a copy per screen, because §4.14 attaches a note
// to a customer, a deal, a quote, an invoice, an appointment, a project and an
// agreement — seven surfaces, and seven copies of this would be seven places
// for the visibility rule to be got wrong. The panel takes what it is about and
// where it lives, so a page adds notes in three lines.
//
// It reads through `notes.list` as the signed-in person, so a colleague's
// private note is absent from the query rather than filtered out on screen.
import { Card, CardBody, CardHeader, Button, Pill } from "@/ui/primitives";
import { formatDateTime } from "@/core/i18n";
import { listNotes, NOTE_VISIBILITIES, type NoteSubject } from "@/core/notes/service";
import type { Actor } from "@/core/service";
import { getT } from "../../i18n";
import { domainOrNull } from "../read-helpers";
import {
  editNoteAction,
  pinNoteAction,
  removeNoteAction,
  writeNoteAction,
} from "../note-actions";

export async function NotesPanel({
  actor,
  subjectType,
  subjectId,
  returnTo,
  locale,
  timezone,
}: {
  actor: Actor;
  subjectType: NoteSubject;
  subjectId: string;
  /** Where the form posts back to, so one panel serves every screen. */
  returnTo: string;
  locale: string;
  timezone: string;
}) {
  const [t, notes] = await Promise.all([
    getT(),
    domainOrNull(listNotes.call({ subjectType, subjectId, limit: 50 }, actor)),
  ]);

  return (
    <Card>
      <CardHeader title={t("notes.title")} />
      <CardBody>
        {notes === null ? (
          <p className="text-sm text-danger">{t("notes.unavailable")}</p>
        ) : notes.length === 0 ? (
          <p className="max-w-prose text-sm text-ink-muted">{t("notes.empty")}</p>
        ) : (
          <ul className="grid list-none gap-2 p-0">
            {notes.map((note) => (
              <li key={note.id} className="grid gap-2 rounded-md border border-rule p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                  {note.pinned ? <Pill tone="accent">{t("notes.pinned")}</Pill> : null}
                  {note.visibility !== "team" ? (
                    <Pill tone={note.visibility === "private" ? "warning" : "success"}>
                      {t(`notes.visibility.${note.visibility}`)}
                    </Pill>
                  ) : null}
                  <span>{note.authorEmail ?? t("notes.bySystem")}</span>
                  <time dateTime={note.createdAt.toISOString()} className="tabular-nums">
                    {formatDateTime(note.createdAt, timezone, locale)}
                  </time>
                  {/* Said once and cheaply: the count is on the note, so this
                      costs no extra query. */}
                  {note.editCount > 0 ? (
                    <span>{t("notes.edited", { count: String(note.editCount) })}</span>
                  ) : null}
                </div>
                {/* A textarea rather than static text: an edit is one keystroke
                    and a button away, and the service files what it said
                    before, so nothing is lost by making it easy. */}
                <form action={editNoteAction} className="grid gap-2">
                  <input type="hidden" name="id" value={note.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <label className="sr-only" htmlFor={`note-body-${note.id}`}>
                    {t("notes.field.body")}
                  </label>
                  <textarea
                    id={`note-body-${note.id}`}
                    name="body"
                    rows={Math.min(8, Math.max(2, note.body.split("\n").length))}
                    defaultValue={note.body}
                    className="w-full rounded-md border border-rule bg-field px-2 py-1 text-sm"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="submit" variant="quiet">
                      {t("notes.action.save")}
                    </Button>
                  </div>
                </form>
                <div className="flex flex-wrap items-center gap-2">
                  <form action={pinNoteAction}>
                    <input type="hidden" name="id" value={note.id} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    {note.pinned ? null : <input type="hidden" name="pinned" value="on" />}
                    <Button type="submit" variant="quiet">
                      {note.pinned ? t("notes.action.unpin") : t("notes.action.pin")}
                    </Button>
                  </form>
                  <form action={removeNoteAction}>
                    <input type="hidden" name="id" value={note.id} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <Button type="submit" variant="quiet">
                      {t("notes.action.remove")}
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form action={writeNoteAction} className="grid gap-2">
          <input type="hidden" name="subjectType" value={subjectType} />
          <input type="hidden" name="subjectId" value={subjectId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <label className="grid gap-1 text-sm">
            <span className="text-ink-muted">{t("notes.add")}</span>
            <textarea
              name="body"
              rows={3}
              required
              className="w-full rounded-md border border-rule bg-field px-2 py-1 text-sm"
            />
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("notes.field.visibility")}</span>
              <select
                name="visibility"
                defaultValue="team"
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              >
                {NOTE_VISIBILITIES.map((visibility) => (
                  <option key={visibility} value={visibility}>
                    {t(`notes.visibility.${visibility}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="pinned" />
              <span className="text-ink-muted">{t("notes.field.pin")}</span>
            </label>
            <Button type="submit">{t("notes.action.add")}</Button>
          </div>
          <p className="max-w-prose text-sm text-ink-muted">{t("notes.hint")}</p>
        </form>
      </CardBody>
    </Card>
  );
}
