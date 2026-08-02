// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
"use client";
// Deleting a file, with the two things that make it safe to offer.
//
// It asks twice, because deleting media is one of the few things in this
// platform that genuinely cannot be undone — the bytes leave the bucket. §37's
// "reversible within one action" is not achievable here, so the next best
// thing is that it cannot happen by a single misplaced click.
//
// And it says what will break. A page still pointing at this file renders a
// gap rather than an error, so nothing goes down — but an owner should learn
// that before rather than discover it afterwards.
import { useState } from "react";
import { Trash } from "@phosphor-icons/react/dist/ssr";
import { cx } from "@/ui/primitives";
import { deleteAssetAction } from "../../media-actions";

export interface DeleteLabels {
  delete: string;
  confirm: string;
  cancel: string;
  usedOn: string;
}

export function DeleteAssetButton({
  id,
  labels,
}: {
  id: string;
  /** Already interpolated with the counts, or empty when nothing uses it. */
  labels: DeleteLabels;
}) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-rule px-2.5 py-1.5 text-xs font-medium text-ink-muted"
      >
        <Trash size={13} weight="bold" />
        {labels.delete}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {labels.usedOn ? (
        <span className="text-xs text-warning">{labels.usedOn}</span>
      ) : null}
      <form action={deleteAssetAction}>
        <input type="hidden" name="id" value={id} />
        <button
          type="submit"
          className={cx(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5",
            "bg-danger-soft text-xs font-semibold text-danger",
          )}
        >
          <Trash size={13} weight="fill" />
          {labels.confirm}
        </button>
      </form>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="text-xs text-ink-muted underline decoration-rule underline-offset-2"
      >
        {labels.cancel}
      </button>
    </div>
  );
}
