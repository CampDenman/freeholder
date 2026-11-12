// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useActionState } from "react";
import { Button, Field, Select } from "@/ui/primitives";
import { resolveReaderOwnershipAction } from "../../reader-ownership-actions";

export function ReaderOwnershipForm({ id, reader, contacts, labels }: {
  id: string;
  reader: { receiptId: string | null; postId: string; commentId: string };
  contacts: Array<{ id: string; name: string; email: string | null }>;
  labels: { person: string; choose: string; confirm: string; submit: string };
}) {
  const [state, action, pending] = useActionState(resolveReaderOwnershipAction, {});
  const selectId = `reader-person-${reader.receiptId ?? `${reader.postId}-${reader.commentId}`}`;
  return <form action={action} className="grid min-w-0 gap-3">
    <input type="hidden" name="id" value={id} />
    <input type="hidden" name="receiptId" value={reader.receiptId ?? ""} />
    <input type="hidden" name="postId" value={reader.postId} />
    <input type="hidden" name="commentId" value={reader.commentId} />
    {state.error ? <p role="alert" className="break-words text-sm text-danger">{state.error}</p> : null}
    <Field htmlFor={selectId} label={labels.person}>
      <Select id={selectId} name="contactId" required defaultValue="">
        <option value="" disabled>{labels.choose}</option>
        {contacts.map(contact => <option key={contact.id} value={contact.id}>{contact.name}{contact.email ? ` — ${contact.email}` : ""}</option>)}
      </Select>
    </Field>
    <label className="flex min-w-0 items-start gap-3 text-sm">
      <input type="checkbox" name="confirmation" value="ASSIGN ORIGINAL READER" required className="mt-1 shrink-0 accent-accent" />
      <span className="min-w-0 break-words">{labels.confirm}</span>
    </label>
    <Button type="submit" disabled={pending}>{labels.submit}</Button>
  </form>;
}
