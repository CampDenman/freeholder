// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The things you can attach something to (MASTER.md §4.14, C7.02, C7.03).
//
// §4.14 gives tasks and notes the same shape for the same reason — "chase the
// deposit" is about the invoice, "they hated the blue one" is about the quote —
// so the list of what can be attached to, and the way an attachment finds the
// person behind it, belong in one place. Extracted from `core/tasks` the moment
// notes became the second caller; two copies of this would drift the first time
// somebody added a kind to one of them.
//
// The trade this makes is deliberate and worth stating. `subject_id` has no
// foreign key, so the database cannot prove it points at a real row, and in
// exchange a module can be added without every attachable thing growing a
// column. C6.15's `project_links` made the same trade. The mitigation is that
// the pair is only ever written by a service that has already loaded the
// subject through `subjectContact` below — never by a form posting two free
// strings.
import { sql } from "drizzle-orm";
import { ServiceError, type Tx } from "@/core/service";

/**
 * What a task or a note can be about.
 *
 * A closed list rather than free text, so a stale kind is a failing parse
 * rather than a row nobody can render. Adding one is a line here and a line in
 * the map below.
 */
export const SUBJECT_KINDS = [
  "contact",
  "deal",
  "quote",
  "invoice",
  "booking",
  "project",
  "contract",
  "order",
] as const;

export type SubjectKind = (typeof SUBJECT_KINDS)[number];

/**
 * Where each kind lives, and where a person goes to look at it.
 *
 * A literal map over a closed list rather than an import of every module: core
 * should not have to depend on invoicing to hold a note about an invoice, and a
 * module that is switched off should make its attachments unresolvable rather
 * than make the whole table unreadable. The table names are constants in this
 * file and the keys come from `SUBJECT_KINDS`, so nothing user-supplied ever
 * reaches the query.
 */
const SUBJECTS: Record<SubjectKind, { table: string; href: (id: string) => string }> = {
  contact: { table: "contacts", href: (id) => `/admin/contacts/${id}` },
  deal: { table: "deals", href: () => "/admin/pipeline" },
  quote: { table: "quotes", href: (id) => `/admin/quotes/${id}` },
  invoice: { table: "invoices", href: (id) => `/admin/invoices/${id}` },
  booking: { table: "bookings", href: (id) => `/admin/appointments/${id}` },
  project: { table: "projects", href: (id) => `/admin/projects/${id}` },
  contract: { table: "contract_documents", href: (id) => `/admin/agreements/${id}` },
  order: { table: "orders", href: (id) => `/admin/orders/${id}` },
};

/** Where to go and look at one, for a list that has to be clickable. */
export function subjectHref(kind: SubjectKind, id: string): string {
  return SUBJECTS[kind].href(id);
}

/**
 * The contact a subject is about, or null.
 *
 * `contacts` answers with itself; everything else carries a `contact_id`. A
 * subject that is not there is refused rather than stored — an attachment
 * pointing at nothing is a row that can never be rendered and never be closed
 * with confidence — and so is one whose module is switched off, because the
 * honest answer to "attach this to an invoice" on an instance with no invoicing
 * is no, not silence.
 */
export async function subjectContact(
  tx: Tx,
  kind: SubjectKind,
  subjectId: string,
): Promise<string | null> {
  const { table } = SUBJECTS[kind];
  const column = kind === "contact" ? "id" : "contact_id";
  try {
    const rows = (await tx.execute(
      sql`select ${sql.raw(column)} as contact_id from ${sql.raw(table)} where id = ${subjectId} limit 1`,
    )) as unknown as Array<{ contact_id: string | null }>;
    if (rows.length === 0) throw new ServiceError("not_found", "That is not here to attach to.");
    return rows[0]!.contact_id ?? null;
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError("validation", "That part of the system is switched off.");
  }
}
