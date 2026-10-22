// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The busy demo: Aurora Coast after six months on Freeholder (C1.38).
//
// The public playground is what evaluators see, and it used to be empty
// exactly where they looked: no products, no contacts, no bookings, a menu
// that said "Locations". These tests hold the opposite: the plain demo is a
// shop you can buy from, a calendar you can book and events you can attend,
// and the busy layer is a business whose books balance. The invariants are
// the ones the services enforce, checked on the bulk-inserted result —
// a sample business that breaks them would teach evaluators the wrong
// product, and would break the first screen that relies on them.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/core/db";
import { installDemo } from "@/modules/seed/service";
import { installBusyDemo } from "@/modules/seed/busy";
import { demoSeedBusy, demoSeedMode } from "@/modules/seed/boot";
import { getSection, searchPublishedPages } from "@/modules/cms/service";
import { HEADER_KEY, NAV_KEY } from "@/modules/cms/defaults";
import { browseProducts, purchaseOptions } from "@/modules/catalog/service";
import { bookableServices } from "@/modules/catalog/public-booking";
import { availableSlots } from "@/core/scheduling/resolver-service";
import { listPublicEvents } from "@/modules/events/service";
import { targetFor } from "@/modules/share/service";
import { mergeContacts } from "@/core/contacts/service";
import { recordOfflinePayment } from "@/modules/invoicing/payment-provider-service";
import { CATALOG, EVENTS, NAV_LINKS, SERVICES } from "../../seed/demo/content";
import { people, random, studioParts, studioTime, world } from "../../seed/demo/busy/world";
import { AREAS } from "../../seed/demo/busy";
import { users } from "@/core/auth/schema";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { ANONYMOUS, closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

/**
 * Budgets. The busy layer is bulk SQL and is held to the playground's reset
 * target outright. The plain demo's time is dominated by image renditions
 * and swings with host load (13–90 s measured on one shared machine), so it
 * gets a ceiling that catches a regression without flaking on a busy runner.
 */
const BUSY_BUDGET_MS = 30_000;
const PLAIN_BUDGET_MS = 180_000;

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db().execute(query)) as unknown as T[];
}

describe("the busy world, before anything installs it", () => {
  it("is deterministic for a given clock and fictional by construction", () => {
    const now = new Date("2026-10-22T19:00:00.000Z");
    const a = world(now);
    const b = world(now);
    expect(a.people).toEqual(b.people);
    expect(a.people.length).toBeGreaterThanOrEqual(150);
    expect(a.people.length).toBeLessThanOrEqual(300);

    const emails = a.people.map((person) => person.email);
    expect(new Set(emails).size).toBe(emails.length);
    for (const email of emails) {
      expect(email).toBe(email.toLowerCase());
      expect(email.endsWith("@example.com")).toBe(true);
    }
    for (const person of a.people) {
      if (person.phone) expect(person.phone).toMatch(/^\+1 250-555-01\d\d$/);
    }
    expect(a.people.some((person) => person.locale === "fr-CA")).toBe(true);
    // Relative to the clock: a later clock moves every date with it.
    const later = world(new Date(now.getTime() + 3_600_000));
    expect(later.daysAgo(10).getTime() - a.daysAgo(10).getTime()).toBe(3_600_000);
    expect(people(random(7))).toEqual(people(random(7)));
  });

  it("puts studio hours on the studio's clock, summer and winter", () => {
    // 9 am in Vancouver is 16:00 UTC under daylight time and 17:00 UTC after
    // the November switch; a fixed offset gets one of them wrong.
    expect(studioTime(new Date("2026-07-14T20:00:00Z"), 9).toISOString()).toBe("2026-07-14T16:00:00.000Z");
    expect(studioTime(new Date("2026-11-10T20:00:00Z"), 9).toISOString()).toBe("2026-11-10T17:00:00.000Z");
    // A Pacific evening is already tomorrow in UTC; the studio's date is not.
    const evening = new Date("2026-07-15T04:30:00Z");
    expect(studioParts(evening)).toMatchObject({ day: 14, hour: 21 });
    expect(studioTime(evening, 9).toISOString()).toBe("2026-07-14T16:00:00.000Z");
    // History asked for "today at five" before five lands in the past.
    const morning = world(new Date("2026-07-14T17:00:00Z")); // 10 am Pacific
    expect(morning.daysAgo(0, 17).getTime()).toBeLessThan(morning.now.getTime());
  });

  it("is on for the playground and for an explicit request only", () => {
    expect(demoSeedBusy({ FREEHOLDER_SEED_DEMO: "1", FREEHOLDER_PLAYGROUND: "1" })).toBe(true);
    expect(demoSeedBusy({ FREEHOLDER_SEED_DEMO: "busy", FREEHOLDER_PLAYGROUND: undefined })).toBe(true);
    expect(demoSeedBusy({ FREEHOLDER_SEED_DEMO: "1", FREEHOLDER_PLAYGROUND: undefined })).toBe(false);
    expect(demoSeedBusy({ FREEHOLDER_SEED_DEMO: undefined, FREEHOLDER_PLAYGROUND: undefined })).toBe(false);
    expect(demoSeedBusy({ FREEHOLDER_SEED_DEMO: "0", FREEHOLDER_PLAYGROUND: "1" })).toBe(false);
    expect(demoSeedMode({ NODE_ENV: "production", FREEHOLDER_SEED_DEMO: "busy" })).toBe("requested");
  });
});

/**
 * The same seed under clocks that broke a fixed UTC−7 offset: a Pacific
 * evening (already tomorrow in UTC) and a winter evening after the PST
 * switch. Each runs every area in a transaction that is rolled back, against
 * the installed plain demo, and is judged against its own pinned clock.
 */
const PINNED_CLOCKS: Array<[string, () => Date]> = [
  ["a Pacific evening", () => studioTime(new Date(), 21, 30)],
  ["a winter evening", () => studioTime(new Date(Date.now() + 20 * 86_400_000), 21, 30)],
];

async function seedAtPinnedClock(pinned: Date): Promise<Array<{ source: string; n: number; detail?: string | null }>> {
  class Rollback extends Error {}
  let findings: Array<{ source: string; n: number; detail?: string | null }> = [];
  await db()
    .transaction(async (tx) => {
      const [staff] = await tx
        .insert(users)
        .values({ email: "pinned.clock@demo.freeholder.test", role: "staff" })
        .returning({ id: users.id });
      const w = { ...world(pinned), ownerUserId: null, staffUserId: staff!.id, liveReminders: false };
      for (const [, seeder] of AREAS) await seeder(tx, w);
      const at = pinned.toISOString();
      // Only rows this transaction wrote: other test files share the
      // database and may commit their own (off-hours) bookings meanwhile.
      const mine = sql.raw("xmin::text::bigint = txid_current() % 4294967296");
      findings = (await tx.execute(sql`
        select 'timeline' as source, count(*)::int as n from timeline_events where ${mine} and occurred_at > ${at}::timestamptz
        union all select 'analytics', count(*)::int from analytics_events where ${mine} and at > ${at}::timestamptz
        union all select 'messages', count(*)::int from messages where ${mine} and created_at > ${at}::timestamptz
        union all select 'payments', count(*)::int from payments where ${mine} and created_at > ${at}::timestamptz
        union all select 'runs', count(*)::int from runs where ${mine} and started_at > ${at}::timestamptz
        union all select 'contacts', count(*)::int from contacts where ${mine} and created_at > ${at}::timestamptz
        union all select 'seeded-bookings', least(count(*), 1)::int - 1 from bookings where ${mine}`)) as unknown as Array<{
        source: string;
        n: number;
        detail?: string | null;
      }>;
      // Studio hours are judged on the application's clock (Node's time-zone
      // data, which the seed and every rendered page use), not Postgres's:
      // the two can ship different tzdata releases. CI's database once read a
      // December sitting an hour later than Node did (16:30 against 15:30),
      // because their releases disagreed about Vancouver's winter offset.
      const sittings = (await tx.execute(sql`
        select status, starts_at, ends_at from bookings where ${mine}`)) as unknown as Array<{
        status: string;
        starts_at: string | Date;
        ends_at: string | Date;
      }>;
      const open: Record<number, [number, number] | null> = {
        0: null, 1: [9, 17], 2: [9, 17], 3: [9, 17], 4: [9, 17], 5: [9, 16], 6: [10, 14],
      };
      const offHours = sittings.filter((sitting) => {
        const start = studioParts(new Date(sitting.starts_at));
        const end = studioParts(new Date(sitting.ends_at));
        const hours = open[start.weekday];
        return (
          !hours ||
          end.day !== start.day ||
          start.hour * 60 + start.minute < hours[0] * 60 ||
          end.hour * 60 + end.minute > hours[1] * 60
        );
      });
      findings.push({
        source: "off-hours",
        n: offHours.length,
        detail: `${pinned.toISOString()}: ${offHours
          .map((sitting) => `${sitting.status} ${new Date(sitting.starts_at).toISOString()} to ${new Date(sitting.ends_at).toISOString()}`)
          .join("; ")}`,
      });
      throw new Rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
  return findings;
}

describe.runIf(hasDatabase)("the installed busy demo", { timeout: 240_000 }, () => {
  let now: Date;
  let elapsed = 0;
  let plainMs = 0;
  let busyMs = 0;
  let counts: Record<string, Record<string, number>> = {};
  const pinnedFindings = new Map<string, Array<{ source: string; n: number; detail?: string | null }>>();

  beforeAll(async () => {
    // The boot the process runs before seeding: module blocks (the
    // newsletter issue page's among them) are registered here.
    const { bootOnce } = await import("@/core/boot");
    const { default: manifests } = await import("@/modules");
    await bootOnce(manifests);
    await truncateSpine();
    const started = Date.now();
    await installDemo.call({ publish: true }, OWNER);
    const plain = Date.now() - started;
    for (const [label, clock] of PINNED_CLOCKS) pinnedFindings.set(label, await seedAtPinnedClock(clock()));
    now = new Date();
    const busyStarted = Date.now();
    counts = (await installBusyDemo.call({ now }, OWNER)).counts;
    busyMs = Date.now() - busyStarted;
    plainMs = plain;
    elapsed = plain + busyMs;
    console.log(`[busy demo] plain demo ${plain} ms, total ${elapsed} ms`, JSON.stringify(counts));
  }, 600_000);

  afterAll(async () => {
    await truncateSpine();
    await closeDb();
  }, 120_000);

  it("seeds within the reset budget and stays small", async () => {
    expect(busyMs).toBeLessThan(BUSY_BUDGET_MS);
    expect(plainMs).toBeLessThan(PLAIN_BUDGET_MS);
    expect(elapsed).toBe(plainMs + busyMs);
    const [size] = await rows<{ bytes: string }>(sql`select pg_database_size(current_database()) as bytes`);
    console.log(`[busy demo] database size ${(Number(size!.bytes) / 1_048_576).toFixed(1)} MB`);
    expect(Number(size!.bytes)).toBeLessThan(150 * 1_048_576);
  });

  it("puts the site's menu in the navigation section, not just Locations", async () => {
    const navigation = await getSection.call({ key: NAV_KEY }, ANONYMOUS);
    const links = ((navigation!.blocks as BlockNode[])[0]!.props as { links: Array<{ href: string }> }).links;
    const hrefs = links.map((link) => link.href);
    for (const link of NAV_LINKS) expect(hrefs).toContain(link.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    const header = await getSection.call({ key: HEADER_KEY }, ANONYMOUS);
    expect(JSON.stringify(header!.blocks)).not.toContain('"nav"');
  });

  it("sells every catalog product with a price, a picture and stock", async () => {
    const options = await purchaseOptions.call({ slugs: CATALOG.map((product) => product.slug) }, ANONYMOUS);
    expect(options.map((entry) => entry.slug).sort()).toEqual(CATALOG.map((product) => product.slug).sort());
    for (const entry of options) {
      expect(JSON.stringify(entry)).toMatch(/"amountMinor":\d+|"priceMinor":\d+/);
    }
    const found = await browseProducts.call({ term: "print", limit: 24, offset: 0, sort: "featured", filters: {} }, ANONYMOUS);
    expect(found.total).toBeGreaterThanOrEqual(3);
    const media = await rows<{ n: number }>(sql`
      select count(distinct p.id)::int as n from products p join product_media m on m.product_id = p.id
      where p.slug in (${sql.join(CATALOG.map((product) => sql`${product.slug}`), sql`, `)})`);
    expect(media[0]!.n).toBe(CATALOG.length);
  });

  it("offers bookable services and upcoming events", async () => {
    const services = await bookableServices.call({}, ANONYMOUS);
    expect(services.services.map((service) => service.name).sort()).toEqual(
      SERVICES.map((service) => service.name).sort(),
    );
    // /book offers real times: the next fortnight has open slots.
    const portrait = services.services.find((service) => service.name === SERVICES[0]!.name)!;
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const slots = await availableSlots.call(
      { productId: portrait.productId, serviceOfferingId: portrait.offeringId, from: day(2), to: day(14), seats: 1, limit: 20 },
      ANONYMOUS,
    );
    expect(slots.length).toBeGreaterThan(0);
    const events = await listPublicEvents.call({}, ANONYMOUS);
    for (const entry of EVENTS) expect(events.map((event) => event.slug)).toContain(entry.slug);
  });

  it("finds pages and journal posts by title and summary, not the shop's pages", async () => {
    const hits = await searchPublishedPages.call({ term: "wedding", limit: 20 }, ANONYMOUS);
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(hits.some((hit) => hit.slug.startsWith("blog/"))).toBe(true);
    expect(hits.every((hit) => hit.slug !== "products" && !hit.slug.startsWith("products/"))).toBe(true);
  });

  it("keeps the share bar to content pages", async () => {
    expect((await targetFor.call({ path: "/contact", locale: "en" }, ANONYMOUS)).shareable).toBe(false);
    expect(
      (await targetFor.call({ path: `/products/${CATALOG[0]!.slug}`, locale: "en" }, ANONYMOUS)).shareable,
    ).toBe(true);
  });

  it("has one contact per email and the promised volume", async () => {
    const [stats] = await rows<{ total: number; distinct_emails: number; sample: number; lower_ok: boolean }>(sql`
      select count(*)::int as total,
             count(distinct email)::int as distinct_emails,
             count(*) filter (where email like '%@example.com')::int as sample,
             bool_and(email is null or email = lower(email)) as lower_ok
      from contacts`);
    expect(stats!.sample).toBeGreaterThanOrEqual(150);
    expect(stats!.sample).toBeLessThanOrEqual(300);
    expect(stats!.lower_ok).toBe(true);
    const [dupes] = await rows<{ n: number }>(sql`
      select count(*)::int as n from (select email from contacts where email is not null group by email having count(*) > 1) d`);
    expect(dupes!.n).toBe(0);
    expect((counts.crm?.contacts ?? 0) + (counts.crm?.lookAlikes ?? 0)).toBe(stats!.sample);
  });

  it("balances every invoice ledger", async () => {
    const unbalanced = await rows<{ id: string }>(sql`
      select i.id from invoices i
      left join (select invoice_id, sum(amount_minor) s from payments where status = 'succeeded' group by invoice_id) p
        on p.invoice_id = i.id
      where i.paid_minor <> coalesce(p.s, 0)`);
    expect(unbalanced).toEqual([]);
    const wrongStatus = await rows<{ id: string }>(sql`
      select id from invoices where (status = 'paid' and (paid_minor <> total_minor or paid_at is null))
         or (status = 'draft' and number is not null)`);
    expect(wrongStatus).toEqual([]);
    const totals = await rows<{ id: string }>(sql`
      select id from invoices where total_minor <> subtotal_minor - discount_minor + shipping_minor + tax_minor`);
    expect(totals).toEqual([]);
    const [numbers] = await rows<{ total: number; distinct_numbers: number }>(sql`
      select count(number)::int as total, count(distinct number)::int as distinct_numbers from invoices`);
    expect(numbers!.distinct_numbers).toBe(numbers!.total);
    const [statuses] = await rows<{ n: number }>(sql`select count(distinct status)::int as n from invoices`);
    expect(statuses!.n).toBeGreaterThanOrEqual(4);
  });

  it("never double-books a calendar and keeps past and future apart", async () => {
    const overlaps = await rows<{ a: string }>(sql`
      select a.id as a from bookings a join bookings b
        on a.calendar_id = b.calendar_id and a.id < b.id
       and a.status not in ('cancelled') and b.status not in ('cancelled')
       and a.starts_at < b.ends_at and b.starts_at < a.ends_at`);
    expect(overlaps).toEqual([]);
    const confused = await rows<{ id: string }>(sql`
      select id from bookings
       where (ends_at < ${now.toISOString()}::timestamptz and status in ('requested', 'confirmed'))
          or (starts_at > ${now.toISOString()}::timestamptz and status in ('completed', 'no_show'))`);
    expect(confused).toEqual([]);
    const [{ n } = { n: 0 }] = await rows<{ n: number }>(sql`select count(*)::int as n from bookings`);
    expect(n).toBeGreaterThanOrEqual(60);
  });

  it("holds event seats within capacity and ends past events in the past", async () => {
    const over = await rows<{ id: string }>(sql`
      select s.id from event_sessions s
      join event_registrations r on r.session_id = s.id and r.status in ('reserved', 'confirmed', 'checked_in')
      group by s.id, s.capacity having sum(r.quantity) > s.capacity`);
    expect(over).toEqual([]);
    const checkedInFuture = await rows<{ id: string }>(sql`
      select r.id from event_registrations r join event_sessions s on s.id = r.session_id
      where r.status = 'checked_in' and s.starts_at > ${now.toISOString()}::timestamptz`);
    expect(checkedInFuture).toEqual([]);
  });

  it("dates no history after the moment it was seeded", async () => {
    const future = await rows<{ source: string; n: number }>(sql`
      select 'timeline' as source, count(*)::int as n from timeline_events where occurred_at > ${now.toISOString()}::timestamptz
      union all select 'analytics', count(*)::int from analytics_events where at > ${now.toISOString()}::timestamptz
      union all select 'messages', count(*)::int from messages where created_at > ${now.toISOString()}::timestamptz
      union all select 'audit', count(*)::int from audit_log where at > ${now.toISOString()}::timestamptz and actor like 'user:%' and action not like 'demo.%'
      union all select 'payments', count(*)::int from payments where created_at > ${now.toISOString()}::timestamptz
      union all select 'runs', count(*)::int from runs where started_at > ${now.toISOString()}::timestamptz`);
    for (const row of future) expect(row).toEqual({ source: row.source, n: 0 });
  });

  it("counts every conversation's messages honestly", async () => {
    const wrong = await rows<{ id: string }>(sql`
      select c.id from conversations c
      left join (select conversation_id, count(*)::int n from messages group by conversation_id) m on m.conversation_id = c.id
      where c.message_count <> coalesce(m.n, 0)`);
    expect(wrong).toEqual([]);
  });

  it("sends newsletters only to people who had consented", async () => {
    const unconsented = await rows<{ id: string }>(sql`
      select r.id from broadcast_recipients r join broadcasts b on b.id = r.broadcast_id
      where not exists (
        select 1 from consent_records c
        where c.contact_id = r.contact_id and c.state = 'granted' and c.occurred_at <= r.sent_at)`);
    expect(unconsented).toEqual([]);
  });

  it.each(PINNED_CLOCKS.map(([label]) => label))(
    "keeps history in the past and sittings in studio hours on %s",
    (label) => {
      const findings = pinnedFindings.get(label);
      expect(findings).toBeDefined();
      for (const row of findings!) expect(row.n, `${row.source} ${row.detail ?? ""}`).toBe(0);
    },
  );

  // The seeded rows are only as good as what the real services make of them.
  it("merges a seeded look-alike pair through the real merge service", async () => {
    const [candidate] = await rows<{ id: string; a: string; b: string }>(sql`
      select id, contact_a_id as a, contact_b_id as b from merge_candidates where status = 'open' order by score desc limit 1`);
    expect(candidate).toBeDefined();
    await mergeContacts.call({ survivingId: candidate!.a, duplicateId: candidate!.b, candidateId: candidate!.id }, OWNER);
    const [left] = await rows<{ n: number }>(sql`select count(*)::int as n from contacts where id = ${candidate!.b}`);
    expect(left!.n).toBe(0);
    const [state] = await rows<{ status: string }>(sql`select status from merge_candidates where id = ${candidate!.id}`);
    expect(state!.status).toBe("merged");
  });

  it("takes the balance of a seeded overdue invoice through the real payment service", async () => {
    const [invoice] = await rows<{ id: string; due: number }>(sql`
      select id, (total_minor - paid_minor)::int as due from invoices
      where status = 'overdue' and total_minor > paid_minor order by due_at limit 1`);
    expect(invoice).toBeDefined();
    await recordOfflinePayment.call(
      {
        invoiceId: invoice!.id,
        method: "bank_transfer",
        amountMinor: invoice!.due,
        evidence: "Sample transfer recorded by the busy demo test.",
        idempotencyKey: `busy-demo-test-${invoice!.id}`,
      },
      OWNER,
    );
    const [after] = await rows<{ status: string; paid: number; total: number; ledger: number }>(sql`
      select i.status, i.paid_minor::int as paid, i.total_minor::int as total,
             coalesce((select sum(amount_minor) from payments p where p.invoice_id = i.id and p.status = 'succeeded'), 0)::int as ledger
      from invoices i where i.id = ${invoice!.id}`);
    expect(after).toMatchObject({ status: "paid", paid: after!.total, ledger: after!.total });
  });

  it("refuses to run twice", async () => {
    await expect(installBusyDemo.call({}, OWNER)).rejects.toMatchObject({ code: "conflict" });
  });
});
