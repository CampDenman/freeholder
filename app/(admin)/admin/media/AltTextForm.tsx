// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Alt text lives on the asset, so it is written once and every page showing
// the image inherits it. §5 requires it on public images, and describing the
// picture rather than its use is what makes one description correct for all
// of them.
import { setAltTextAction } from "../../media-actions";

export function AltTextForm({
  id,
  value,
  labels,
}: {
  id: string;
  value: string;
  labels: { label: string; hint: string; save: string };
}) {
  return (
    <form action={setAltTextAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <div className="grid min-w-52 flex-1 gap-1.5">
        <label
          htmlFor={`alt-${id}`}
          className="font-mono text-xs font-medium text-ink-muted"
        >
          {labels.label}
        </label>
        <input
          id={`alt-${id}`}
          name="altText"
          defaultValue={value}
          placeholder={labels.hint}
          className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus-visible:border-accent"
        />
      </div>
      <button
        type="submit"
        className="rounded-md border border-rule px-3 py-2 text-sm font-medium text-ink"
      >
        {labels.save}
      </button>
    </form>
  );
}
