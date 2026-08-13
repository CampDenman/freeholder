// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Publish or unpublish. A form, because it changes what the public can see.
import { setPagePublishedAction } from "../../../cms-actions";

export function PublishToggle({
  id,
  published,
  label,
}: {
  id: string;
  published: boolean;
  label: string;
}) {
  return (
    <form action={setPagePublishedAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="published" value={published ? "false" : "true"} />
      <button
        type="submit"
        className="rounded-md border border-rule px-3 py-1.5 text-sm font-medium text-ink"
      >
        {label}
      </button>
    </form>
  );
}
