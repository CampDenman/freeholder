// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Deliberate entry by a human. Automated paths use contacts.resolve instead,
// so a form submission never mints a second record for somebody already known.
import { ContactForm } from "../ContactForm";
import { requireStaffActor } from "../../guard";

export const dynamic = "force-dynamic";

export default async function NewContactPage() {
  await requireStaffActor();
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">New contact</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Every part of the platform will share this one record.
        </p>
      </div>
      <ContactForm
        values={{
          name: "",
          email: "",
          phone: "",
          lifecycleStage: "lead",
          tags: [],
          ownerNotes: "",
        }}
      />
    </div>
  );
}
