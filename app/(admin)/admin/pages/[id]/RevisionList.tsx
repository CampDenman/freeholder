// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Earlier versions, newest first (MASTER.md §32: "visible version history and
// one-click restore").
//
// Restoring is itself revisioned by the service, so this list never becomes a
// one-way door — which is what §37 means by reversible in one action.
import { restoreRevisionAction } from "../../../cms-actions";

export function RevisionList({
  revisions,
  restoreLabel,
}: {
  revisions: { id: string; when: string }[];
  restoreLabel: string;
}) {
  return (
    <ol className="grid list-none gap-0 p-0">
      {revisions.map((revision) => (
        <li
          key={revision.id}
          className="flex flex-wrap items-center gap-3 border-b border-rule py-2.5 last:border-b-0"
        >
          <time className="font-mono text-xs text-ink-muted tabular-nums">
            {revision.when}
          </time>
          <form action={restoreRevisionAction} className="ms-auto">
            <input type="hidden" name="revisionId" value={revision.id} />
            <button
              type="submit"
              className="rounded-md border border-rule px-2.5 py-1 text-xs font-medium text-ink"
            >
              {restoreLabel}
            </button>
          </form>
        </li>
      ))}
    </ol>
  );
}
