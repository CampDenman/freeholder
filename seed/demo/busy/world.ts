// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The deterministic world the busy demo is drawn from (C1.38).
//
// The playground resets every hour, and an evaluator who opens it at 3pm
// should see a studio that has been trading for six months *up to 3pm* — not
// a snapshot frozen on the day somebody wrote the seed. So every date here is
// relative to `now`, and every choice comes from a seeded generator so the
// same `now` always yields the same business: tests can assert exact shapes
// and a screenshot taken twice an hour apart differs only by the hour.
//
// Everyone in it is fictional. Addresses are @example.com (RFC 2606), phone
// numbers sit in the 555-01xx block reserved for fiction, and the names are
// drawn from common first and last names so no row resembles one real person.
import type { Tx } from "@/core/service";

export const DAY = 86_400_000;
export const HOUR = 3_600_000;

/** mulberry32 — tiny, fast, and identical on every platform. */
export function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Random {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
  /** Weighted toward the summer wedding season (May–September). */
  seasonal(date: Date): number;
}

export function random(seed: number): Random {
  const next = rng(seed);
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)]!,
    chance: (p) => next() < p,
    seasonal: (date) => {
      const month = date.getUTCMonth();
      return [0.55, 0.6, 0.75, 0.9, 1.15, 1.4, 1.5, 1.45, 1.3, 1, 0.8, 0.85][month]!;
    },
  };
}

const FIRST = [
  "Ava", "Liam", "Maya", "Noah", "Chloé", "Owen", "Isla", "Ethan", "Léa", "Lucas",
  "Harper", "Mateo", "Zoe", "Elijah", "Camille", "Theo", "Nora", "Félix", "Ruby", "Jack",
  "Amélie", "Wyatt", "Hannah", "Samuel", "Gabrielle", "Leo", "Priya", "Arjun", "Mei", "Kenji",
  "Sofia", "Diego", "Aisha", "Omar", "Freya", "Rowan", "Elena", "Marco", "Tessa", "Callum",
  "Juliette", "Benoît", "Grace", "Henry", "Ingrid", "Jonah", "Keira", "Louis", "Mila", "Nathan",
] as const;

const LAST = [
  "Bennett", "Tremblay", "Nguyen", "Gagnon", "MacLeod", "Roy", "Patel", "Côté", "Campbell", "Bouchard",
  "Chen", "Gauthier", "Wilson", "Morin", "Singh", "Lavoie", "Fraser", "Fortin", "Kim", "Gélinas",
  "Anderson", "Pelletier", "Okafor", "Bélanger", "Reid", "Lévesque", "Hughes", "Bergeron", "Sato", "Leblanc",
  "Murray", "Ouellet", "Walsh", "Girard", "Tanaka", "Dubois", "Ross", "Simard", "Larsen", "Poirier",
] as const;

const FRENCH_FIRST = new Set(["Chloé", "Léa", "Camille", "Félix", "Amélie", "Gabrielle", "Juliette", "Benoît", "Louis"]);

export const TOWNS = [
  { city: "Courtenay", region: "BC" },
  { city: "Comox", region: "BC" },
  { city: "Cumberland", region: "BC" },
  { city: "Campbell River", region: "BC" },
  { city: "Nanaimo", region: "BC" },
  { city: "Victoria", region: "BC" },
  { city: "Vancouver", region: "BC" },
  { city: "Montréal", region: "QC" },
] as const;

export const SOURCES = ["contact", "instagram", "referral", "google", "wedding-fair", "newsletter", "import", "manual"] as const;

export interface Person {
  key: string;
  name: string;
  first: string;
  email: string;
  phone: string | null;
  locale: "en" | "fr-CA";
  city: string;
  region: string;
  source: (typeof SOURCES)[number];
  /** How long ago the studio first heard from them. */
  firstSeenDaysAgo: number;
  lifecycle: "lead" | "prospect" | "customer" | "repeat";
  /** Organisation index into ORGANISATIONS, for the few business clients. */
  org: number | null;
  tags: string[];
}

/** The handful of businesses that commission the studio. */
export const ORGANISATIONS = [
  { name: "Tidewater Inn (sample)", domain: "tidewater-inn.example.com" },
  { name: "Glacier View Weddings (sample)", domain: "glacierview.example.com" },
  { name: "Tidepool Arts Collective (sample)", domain: "tidepool-arts.example.com" },
  { name: "Saltwater Kitchen (sample)", domain: "saltwater-kitchen.example.com" },
  { name: "Northshore Realty (sample)", domain: "northshore-realty.example.com" },
] as const;

function slugPart(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, "");
}

/**
 * The studio's people: ~220 of them, the shape a six-month-old studio
 * accumulates. Emails are unique by construction (a numeric suffix on the
 * rare collision), because the spine's unique index will refuse a duplicate
 * and the merge-candidates screen gets its examples from look-alike *names*,
 * not reused addresses.
 */
export function people(r: Random, count = 220): Person[] {
  const used = new Set<string>();
  const out: Person[] = [];
  let phone = 100;
  for (let i = 0; i < count; i += 1) {
    const first = r.pick(FIRST);
    const last = r.pick(LAST);
    let local = `${slugPart(first)}.${slugPart(last)}`;
    let n = 2;
    while (used.has(local)) local = `${slugPart(first)}.${slugPart(last)}${n++}`;
    used.add(local);
    const french = FRENCH_FIRST.has(first) && r.chance(0.7);
    const town = french && r.chance(0.5) ? TOWNS[7] : r.pick(TOWNS.slice(0, 7));
    const firstSeenDaysAgo = Math.floor(Math.pow(r.next(), 0.8) * 180);
    const roll = r.next();
    const lifecycle = roll < 0.35 ? "lead" : roll < 0.55 ? "prospect" : roll < 0.85 ? "customer" : "repeat";
    const org = i % 37 === 5 ? (i / 37) % ORGANISATIONS.length | 0 : null;
    const tags: string[] = [];
    if (r.chance(0.3)) tags.push("wedding-2027");
    if (r.chance(0.25)) tags.push("portrait");
    if (r.chance(0.12)) tags.push("print-buyer");
    if (r.chance(0.08)) tags.push("vip");
    if (french) tags.push("francophone");
    out.push({
      key: `p${i}`,
      name: `${first} ${last}`,
      first,
      email: `${local}@example.com`,
      // Only 100 fictional numbers exist (555-0100…0199), so roughly a third
      // of people have one; the rest are email-only, as most enquiries are.
      phone: phone <= 199 && r.chance(0.45) ? `+1 250-555-0${phone++}` : null,
      locale: french ? "fr-CA" : "en",
      city: town.city,
      region: town.region,
      source: r.pick(SOURCES),
      firstSeenDaysAgo,
      lifecycle,
      org,
      tags,
    });
  }
  return out;
}

/** The seed's single clock and generator, handed to every area seeder. */
export interface World {
  now: Date;
  r: Random;
  people: Person[];
  /** person.key → contact id, filled by the CRM seeder before anything else runs. */
  contactIds: Map<string, string>;
  /** The owner and the assistant every audit row is attributed to. */
  ownerUserId: string | null;
  staffUserId: string;
  /**
   * Whether seeded future reminders may stay scheduled. Only in the public
   * playground, where external delivery is blocked at the service layer;
   * a `busy` demo on a box with real mail must not email sample people.
   */
  liveReminders: boolean;
  daysAgo(days: number, hour?: number): Date;
  daysAhead(days: number, hour?: number): Date;
}

/** The studio's wall clock. */
export const STUDIO_TZ = "America/Vancouver";

const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: STUDIO_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  weekday: "short",
});

/** The studio's local calendar fields for an instant. */
export function studioParts(date: Date): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const map = Object.fromEntries(parts.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(map.weekday!),
  };
}

/**
 * The instant a studio wall clock reads `hour:minute` on the studio-local
 * date of `date`. Daylight saving is the zone's, not a fixed offset: a
 * nine o'clock sitting is at nine in July and in January.
 */
export function studioTime(date: Date, hour: number, minute = 0): Date {
  const local = studioParts(date);
  const wanted = Date.UTC(local.year, local.month - 1, local.day, hour, minute);
  let guess = wanted;
  for (let i = 0; i < 2; i += 1) {
    const seen = studioParts(new Date(guess));
    const seenUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
    guess += wanted - seenUtc;
  }
  return new Date(guess);
}

export function world(now: Date, seed = 20261022): Omit<World, "ownerUserId" | "staffUserId" | "liveReminders"> {
  const r = random(seed);
  const at = (offsetDays: number, hour?: number) => {
    const date = new Date(now.getTime() + offsetDays * DAY);
    return hour === undefined ? date : studioTime(date, hour);
  };
  return {
    now,
    r,
    people: people(random(seed + 1)),
    contactIds: new Map(),
    // History never lands after the seed's own clock: "today at 5pm" asked
    // for at 10am becomes a few minutes ago. A negative count is a date ahead
    // and is left alone, as is daysAhead.
    daysAgo: (days, hour) => {
      const date = at(-days, hour);
      return days < 0 || date.getTime() < now.getTime() ? date : new Date(now.getTime() - 5 * 60_000);
    },
    daysAhead: (days, hour) => at(days, hour),
  };
}

/** One area of the busy business. Returns row counts for the boot log and tests. */
export type AreaSeeder = (tx: Tx, world: World) => Promise<Record<string, number>>;
