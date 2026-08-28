// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useActionState, useEffect, useState } from "react";
import { AddressBook, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Button, Callout } from "@/ui/primitives";
import {
  stageDeviceContactsAction,
  type ContactImportActionState,
} from "./actions";

interface DeviceContact {
  name?: string[];
  email?: string[];
  tel?: string[];
}

interface ContactsManager {
  select(
    properties: Array<"name" | "email" | "tel">,
    options: { multiple: boolean },
  ): Promise<DeviceContact[]>;
}

function manager(): ContactsManager | null {
  return (navigator as Navigator & { contacts?: ContactsManager }).contacts ?? null;
}

export function DeviceContactPicker({
  fields,
  maxContacts,
  labels,
}: {
  fields: Array<"email" | "name" | "phone">;
  maxContacts: number;
  labels: Record<string, string>;
}) {
  const [supported, setSupported] = useState(false);
  const [contacts, setContacts] = useState<Array<{ name: string; email: string; phone: string }>>([]);
  const [localError, setLocalError] = useState<string>();
  const [state, action, pending] = useActionState<ContactImportActionState, FormData>(
    stageDeviceContactsAction,
    {},
  );
  useEffect(() => setSupported(Boolean(manager())), []);

  async function choose() {
    setLocalError(undefined);
    try {
      const properties = fields.map((field) => (field === "phone" ? "tel" : field));
      const selected = await manager()!.select(properties, { multiple: true });
      if (selected.length > maxContacts) {
        setContacts([]);
        setLocalError(labels.tooMany!.replace("{count}", String(maxContacts)));
        return;
      }
      setContacts(
        selected.map((contact) => ({
          name: contact.name?.[0]?.trim() ?? "",
          email: contact.email?.[0]?.trim() ?? "",
          phone: contact.tel?.[0]?.trim() ?? "",
        })),
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setLocalError(labels.failed);
    }
  }

  if (!supported) {
    return <p className="text-sm text-ink-muted">{labels.unsupported}</p>;
  }
  return (
    <div className="grid gap-4">
      <div>
        <Button type="button" variant="quiet" onClick={() => void choose()}>
          <AddressBook size={17} weight="bold" />
          {labels.choose}
        </Button>
      </div>
      {localError || state.error ? (
        <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
          {localError ?? state.error}
        </Callout>
      ) : null}
      {contacts.length > 0 ? (
        <form action={action} className="grid gap-4" aria-busy={pending}>
          <input type="hidden" name="contacts" value={JSON.stringify(contacts)} />
          {fields.map((field) => <input key={field} type="hidden" name="field" value={field} />)}
          <p className="text-sm font-semibold">
            {labels.selected!.replace("{count}", String(contacts.length))}
          </p>
          <div className="max-h-72 overflow-auto rounded-md border border-rule">
            <table className="w-full text-start text-sm">
              <thead className="sticky top-0 bg-surface-subtle text-xs text-ink-muted">
                <tr>
                  {fields.map((field) => <th key={field} className="px-3 py-2">{labels[field]}</th>)}
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact, index) => (
                  <tr key={`${contact.email}-${index}`} className="border-t border-rule">
                    {fields.map((field) => (
                      <td key={field} className="px-3 py-2">
                        {contact[field] || labels.blank}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-ink-muted">{labels.previewHint}</p>
          <div><Button type="submit" disabled={pending}>{pending ? labels.working : labels.preview}</Button></div>
        </form>
      ) : null}
    </div>
  );
}
