// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useActionState } from "react";
import { Button, Field, Select } from "@/ui/primitives";
import { resolveReaderOwnershipBatchAction } from "../../reader-ownership-actions";

// Every checkbox names one unchanged original, with its own person selection.
export function ReaderOwnershipBatchForm({ id, readers, contacts, labels }: {
  id: string;
  readers: Array<{ receiptId: string | null; postId: string; commentId: string; name: string; email: string | null; excerpt: string }>;
  contacts: Array<{ id: string; name: string; email: string | null }>;
  labels: { person: string; choose: string; confirm: string; submit: string; intro: string };
}) {
  const [state, action, pending] = useActionState(resolveReaderOwnershipBatchAction, {});
  return <form action={action} className="grid min-w-0 gap-5">
    <input type="hidden" name="id" value={id} />
    <p className="break-words text-sm text-ink-muted">{labels.intro}</p>
    {state.error ? <p role="alert" className="break-words text-sm text-danger">{state.error}</p> : null}
    <ol className="grid min-w-0 list-none gap-5 p-0">{readers.map(reader => {
      const key = `${reader.receiptId ?? ""}:${reader.postId}:${reader.commentId}`;
      const selectId = `reader-person-${reader.postId}-${reader.commentId}`;
      return <li key={key} className="grid min-w-0 gap-3 rounded-md border border-rule p-3">
        <p className="break-words font-medium">{reader.name}</p>
        {reader.email ? <p className="min-w-0 break-all text-sm"><bdi dir="ltr">{reader.email}</bdi></p> : null}
        <p className="break-words text-sm text-ink-muted">{reader.excerpt}</p>
        <Field htmlFor={selectId} label={labels.person}>
          <Select id={selectId} name={`person:${key}`} defaultValue="">
            <option value="">{labels.choose}</option>
            {contacts.map(contact => <option key={contact.id} value={contact.id}>{contact.name}{contact.email ? ` — ${contact.email}` : ""}</option>)}
          </Select>
        </Field>
        <label className="flex min-w-0 items-start gap-3 text-sm">
          <input type="checkbox" name="selected" value={key} className="mt-1 shrink-0 accent-accent" />
          <span className="min-w-0 break-words">{labels.confirm}</span>
        </label>
      </li>;
    })}</ol>
    <Button type="submit" disabled={pending}>{labels.submit}</Button>
  </form>;
}
