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
import { getSection } from "@/modules/cms/service";
import { HEADER_KEY, NAV_KEY } from "@/modules/cms/defaults";
import { browseProducts, purchaseOptions } from "@/modules/catalog/service";
import { bookableServices } from "@/modules/catalog/public-booking";
import { availableSlots } from "@/core/scheduling/resolver-service";
import { listPublicEvents } from "@/modules/events/service";
import { targetFor } from "@/modules/share/service";
import { CATALOG, EVENTS, NAV_LINKS, SERVICES } from "../../seed/demo/content";
import { people, random, world } from "../../seed/demo/busy/world";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { ANONYMOUS, closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

/** Wall-clock budget for demo + busy seed on a developer machine or CI runner. */
const SEED_BUDGET_MS = 90_000;

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

  it("is on for the playground and for an explicit request only", () => {
    expect(demoSeedBusy({ FREEHOLDER_SEED_DEMO: "1", FREEHOLDER_PLAYGROUND: "1" })).toBe(true);
    expect(demoSeedBusy({ FREEHOLDER_SEED_DEMO: "busy", FREEHOLDER_PLAYGROUND: undefined })).toBe(true);
    expect(demoSeedBusy({ FREEHOLDER_SEED_DEMO: "1", FREEHOLDER_PLAYGROUND: undefined })).toBe(false);
    expect(demoSeedBusy({ FREEHOLDER_SEED_DEMO: undefined, FREEHOLDER_PLAYGROUND: undefined })).toBe(false);
    expect(demoSeedBusy({ FREEHOLDER_SEED_DEMO: "0", FREEHOLDER_PLAYGROUND: "1" })).toBe(false);
    expect(demoSeedMode({ NODE_ENV: "production", FREEHOLDER_SEED_DEMO: "busy" })).toBe("requested");
  });
});

describe.runIf(hasDatabase)("the installed busy demo", { timeout: 240_000 }, () => {
  let now: Date;
  let elapsed = 0;
  let counts: Record<string, Record<string, number>> = {};

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
    now = new Date();
    counts = (await installBusyDemo.call({ now }, OWNER)).counts;
    elapsed = Date.now() - started;
    console.log(`[busy demo] plain demo ${plain} ms, total ${elapsed} ms`, JSON.stringify(counts));
  }, 600_000);

  afterAll(async () => {
    await truncateSpine();
    await closeDb();
  });

  it("seeds within the reset budget and stays small", async () => {
    expect(elapsed).toBeLessThan(SEED_BUDGET_MS);
    const [size] = await rows<{ bytes: string }>(sql`select pg_database_size(current_database()) as bytes`);
    console.log(`[busy demo] database size ${(Number(size!.bytes) / 1_048_576).toFixed(1)} MB`);
    expect(Number(size!.bytes)).toBeLessThan(400 * 1_048_576);
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
      union all select 'payments', count(*)::int from payments where created_at > ${now.toISOString()}::timestamptz`);
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

  it("refuses to run twice", async () => {
    await expect(installBusyDemo.call({}, OWNER)).rejects.toMatchObject({ code: "conflict" });
  });
});
