// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { Button } from "@/ui/primitives";
import { convertQuoteAction } from "../../../quote-actions";

/**
 * Turn an accepted quote into the job.
 *
 * Confirmation is a native `confirm` on submit rather than a dialog
 * component: converting twice is refused by the service, but the first
 * conversion drafts invoices, and that is worth a pause.
 */
export function ConvertQuoteForm({
  id,
  label,
  confirm: message,
}: {
  id: string;
  label: string;
  confirm: string;
}) {
  return (
    <form
      action={convertQuoteAction}
      onSubmit={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <Button type="submit">{label}</Button>
    </form>
  );
}
