// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One invoice numbering for the whole sample business (C1.38 busy demo).
//
// Sales and event admissions are seeded by different areas, each taking the
// next number as it went, so numbers came out in seeding order rather than
// issue order — invoice 0090 dated before invoice 0012. The real service
// allocates at issue time, so a ledger read by number reads by date. This
// renumbers every issued invoice once, by issue date, and carries the new
// numbers into the timeline entries that quote them and the sequence's next
// value.
import { sql } from "drizzle-orm";
import type { AreaSeeder } from "./world";

export const seedLedger: AreaSeeder = async (tx) => {
  // Two steps, because the unique index is checked row by row: park every
  // number on a placeholder first, then hand out the final ones.
  await tx.execute(sql`update invoices set number = 'renumber-' || id::text where number is not null`);
  const renumbered = (await tx.execute(sql`
    with seq as (
      select coalesce((select prefix from invoice_sequences where key = 'invoice'), 'INV-') as prefix,
             coalesce((select padding from invoice_sequences where key = 'invoice'), 6) as padding
    ), ordered as (
      select id, row_number() over (order by issued_at, created_at, id) as n
      from invoices where number is not null
    )
    update invoices i
       set number = seq.prefix || lpad(ordered.n::text, seq.padding, '0')
      from ordered, seq
     where ordered.id = i.id
    returning i.id`)) as unknown as Array<{ id: string }>;
  await tx.execute(sql`
    insert into invoice_sequences (key, prefix, next_value, padding)
    values ('invoice', 'INV-', ${renumbered.length + 1}, 6)
    on conflict (key) do update set next_value = ${renumbered.length + 1}`);
  await tx.execute(sql`
    update timeline_events t
       set payload = jsonb_set(t.payload, '{number}', to_jsonb(i.number))
      from invoices i
     where t.subject_type = 'invoice' and t.subject_id = i.id::text and t.payload ? 'number'`);
  return { invoicesNumbered: renumbered.length };
};
