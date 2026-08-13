// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// Moving a file to recoverable trash, with explicit confirmation.
//
// It asks twice so a misplaced click cannot remove a live image. The bytes
// remain in recoverable trash for thirty days; permanent purge is separate.
//
// It also says what will disappear. A page still pointing at this file renders a
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
