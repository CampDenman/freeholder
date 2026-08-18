// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Earlier versions, newest first (MASTER.md §32: "visible version history and
// one-click restore").
//
// Restoring is itself revisioned by the service, so this list never becomes a
// one-way door — which is what §37 means by reversible in one action.
import {
  nameRevisionAction,
  restoreRevisionAction,
  snapshotRevisionAction,
} from "../../../cms-actions";

export function RevisionList({
  pageId,
  revisions,
  authors,
  labels,
}: {
  pageId: string;
  revisions: {
    id: string;
    when: string;
    author: string;
    name: string | null;
    kind: string;
    kindLabel: string;
  }[];
  authors: string[];
  labels: {
    restore: string;
    compare: string;
    name: string;
    namePlaceholder: string;
    saveNamed: string;
    unnamed: string;
    authors: string;
  };
}) {
  return (
    <div className="grid gap-4">
      {authors.length > 0 ? (
        <p className="text-sm text-ink-muted">
          {labels.authors} {authors.join(", ")}
        </p>
      ) : null}
      <form action={snapshotRevisionAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="id" value={pageId} />
        <label className="grid gap-1 text-sm">
          <span className="text-ink-muted">{labels.name}</span>
          <input
            type="text"
            name="name"
            required
            placeholder={labels.namePlaceholder}
            className="rounded-md border border-rule bg-surface px-3 py-2 text-ink"
          />
        </label>
        <button
          type="submit"
          className="rounded-md border border-rule px-3 py-1.5 text-sm font-medium text-ink"
        >
          {labels.saveNamed}
        </button>
      </form>
      <ol className="grid list-none gap-0 p-0">
        {revisions.map((revision) => (
          <li
            key={revision.id}
            className="flex flex-wrap items-center gap-3 border-b border-rule py-2.5 last:border-b-0"
          >
            <div className="grid gap-0.5">
              <span className="text-sm text-ink">
                {revision.name ?? revision.kindLabel ?? labels.unnamed}
              </span>
              <time className="font-mono text-xs text-ink-muted tabular-nums">
                {revision.when} · {revision.author}
              </time>
            </div>
            <div className="ms-auto flex flex-wrap items-center gap-2">
              {revision.name ? null : (
                <form action={nameRevisionAction} className="flex items-center gap-2">
                  <input type="hidden" name="revisionId" value={revision.id} />
                  <input
                    type="text"
                    name="name"
                    required
                    aria-label={labels.name}
                    placeholder={labels.namePlaceholder}
                    className="w-36 rounded-md border border-rule bg-surface px-2 py-1 text-xs text-ink"
                  />
                </form>
              )}
              <a
                href={`?compare=${revision.id}`}
                className="rounded-md border border-rule px-2.5 py-1 text-xs font-medium text-ink"
              >
                {labels.compare}
              </a>
              <form action={restoreRevisionAction}>
                <input type="hidden" name="revisionId" value={revision.id} />
                <button
                  type="submit"
                  className="rounded-md border border-rule px-2.5 py-1 text-xs font-medium text-ink"
                >
                  {labels.restore}
                </button>
              </form>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
