// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useActionState } from "react";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Field,
  Input,
} from "@/ui/primitives";
import {
  saveTranslationAction,
  type TranslationActionState,
} from "../../translation-actions";

export interface TranslationRow {
  /** Opaque; it is the input's name and comes back unchanged. */
  key: string;
  source: string;
  value: string;
  /** `heading`, `text`, or a field of the page itself like `title`. */
  group: string;
  label: string;
  multiline: boolean;
}

export interface TranslationLabels {
  cardTitle: string;
  intro: string;
  source: string;
  target: string;
  save: string;
  pending: string;
  saved: string;
  markReviewed: string;
  reviewedHint: string;
  status: string;
  empty: string;
}

/**
 * A translation, written beside the words it translates (MASTER.md §4.9).
 *
 * Side by side rather than one-at-a-time, because the unit of work is a page:
 * a translator needs the heading in view while they write the paragraph under
 * it. The list is derived from the source tree (see cms/translate.ts), so a
 * translator is never shown a block id, an image path or a JSON brace — only
 * sentences.
 *
 * Reviewed is a checkbox rather than a separate publish step, and it is the
 * whole of §4.9's "machine translation may draft, never publish silently": the
 * public read path serves `reviewed` only, so leaving this unticked is what
 * keeps an unfinished translation off the site while it is being written.
 */
export function TranslationEditor({
  entityId,
  locale,
  rows,
  reviewed,
  labels,
}: {
  entityId: string;
  locale: string;
  rows: TranslationRow[];
  reviewed: boolean;
  labels: TranslationLabels;
}) {
  const [state, action, pending] = useActionState<TranslationActionState, FormData>(
    saveTranslationAction,
    {},
  );

  // Grouped for the eye, not for the data: consecutive rows from one block are
  // one card, so a heading and its paragraph do not read as unrelated boxes.
  const groups: { group: string; rows: TranslationRow[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.group === row.group) last.rows.push(row);
    else groups.push({ group: row.group, rows: [row] });
  }

  return (
    <form action={action}>
      <input type="hidden" name="entityId" value={entityId} />
      <input type="hidden" name="locale" value={locale} />
      <Card>
        <CardHeader title={labels.cardTitle} />
        <CardBody>
          {state.error ? (
            <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
              {state.error}
            </Callout>
          ) : null}
          {state.saved ? (
            <Callout tone="success" icon={<CheckCircle size={17} weight="fill" />}>
              {labels.saved}
            </Callout>
          ) : null}
          <p className="max-w-prose text-sm text-ink-muted">{labels.intro}</p>

          {rows.length === 0 ? (
            <p className="text-sm text-ink-muted">{labels.empty}</p>
          ) : null}

          {groups.map((group, index) => (
            <fieldset
              key={index}
              className="grid gap-4 rounded-md border border-rule p-4"
            >
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {group.group}
              </legend>
              {group.rows.map((row) => (
                <div key={row.key} className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium text-ink-muted">
                      {labels.source} — {row.label}
                    </p>
                    {/* The source is shown, never edited: editing it here
                        would silently rewrite the page in its own language. */}
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
                      {row.source}
                    </p>
                  </div>
                  <Field label={`${labels.target} — ${row.label}`} htmlFor={row.key}>
                    {row.multiline ? (
                      <textarea
                        id={row.key}
                        name={`t.${row.key}`}
                        defaultValue={row.value}
                        rows={Math.min(10, Math.max(3, row.source.split("\n").length + 1))}
                        className="w-full rounded-md border border-rule bg-surface px-3 py-2 text-sm text-ink"
                      />
                    ) : (
                      <Input id={row.key} name={`t.${row.key}`} defaultValue={row.value} />
                    )}
                  </Field>
                </div>
              ))}
            </fieldset>
          ))}
        </CardBody>
        <CardFooter>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              name="reviewed"
              defaultChecked={reviewed}
              className="size-4 accent-[var(--color-accent)]"
            />
            {labels.markReviewed}
          </label>
          <span className="text-xs text-ink-muted">{labels.reviewedHint}</span>
          <Button type="submit" disabled={pending} className="ms-auto">
            {pending ? labels.pending : labels.save}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
