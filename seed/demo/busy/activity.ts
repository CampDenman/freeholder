// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The studio's activity: six months of first-party traffic, the inbox, the
// member community, automations with their run history, and the audit trail
// (C1.38 busy demo).
//
// Traffic is the bulk of the busy seed by row count, so it is shaped for size
// as much as for realism: roughly 20–30k analytics rows across 179 days (just
// inside the 180-day default retention, so the purge job does not eat the
// oldest week on its first sweep), inserted in chunks that stay well under
// Postgres's 65,535 bind-parameter ceiling.
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { auditLog } from "@/core/events/schema";
import { conversations, messages } from "@/core/messaging/schema";
import { notifications } from "@/core/notifications/schema";
import { runApprovals, runs, runSteps } from "@/core/runs/schema";
import type { Tx } from "@/core/service";
import { analyticsAttributions, analyticsEvents } from "@/modules/analytics/schema";
import {
  automationContactState,
  automations,
  automationVersions,
} from "@/modules/automations/schema";
import {
  memberComments,
  memberFollows,
  memberPosts,
  memberProfiles,
  memberReactions,
} from "@/modules/members/schema";
import { DAY, HOUR, type AreaSeeder, type Person, type World } from "./world";

/** Insert in chunks so a wide table never crosses the bind-parameter limit. */
async function bulk<T>(
  rows: T[],
  size: number,
  insert: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size));
}

/* ------------------------------------------------------------- analytics */

const PATHS: Array<[string, number]> = [
  ["/", 30],
  ["/services", 14],
  ["/services/weddings", 16],
  ["/services/portraits", 9],
  ["/about", 7],
  ["/contact", 6],
  ["/planning", 5],
  ["/blog", 6],
  ["/newsletters", 2],
  ["/book", 4],
  ["/events", 3],
  ["/products/driftwood-dawn-print", 3],
  ["/products/strait-in-fog-print", 2],
  ["/products/headland-low-tide-print", 2],
  ["/products/aurora-coast-gift-card", 1],
  ["/locations/courtenay", 1],
];
const PATH_TOTAL = PATHS.reduce((sum, [, weight]) => sum + weight, 0);

interface Touch {
  source: string;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
}

/** Where a visit came from: referrer host plus an optional UTM touch. */
const SOURCES: Array<{ weight: number; referrer: string | null; touch: Touch | null; landing?: string }> = [
  { weight: 34, referrer: "google.com", touch: null },
  { weight: 22, referrer: null, touch: null },
  { weight: 14, referrer: "instagram.com", touch: { source: "instagram", medium: "social", campaign: "summer-weddings-2026", term: null, content: "reel" } },
  { weight: 6, referrer: "l.instagram.com", touch: { source: "instagram", medium: "social", campaign: "portrait-minis-fall", term: null, content: "story" } },
  { weight: 8, referrer: null, touch: { source: "newsletter", medium: "email", campaign: "aurora-coast-letter", term: null, content: null }, landing: "/blog" },
  { weight: 7, referrer: "glacierview.example.com", touch: { source: "glacierview", medium: "referral", campaign: "preferred-vendors", term: null, content: null }, landing: "/services/weddings" },
  { weight: 5, referrer: "bing.com", touch: null },
  { weight: 4, referrer: "google.com", touch: { source: "google", medium: "cpc", campaign: "wedding-photographer-comox", term: "comox wedding photographer", content: null }, landing: "/services/weddings" },
];
const SOURCE_TOTAL = SOURCES.reduce((sum, s) => sum + s.weight, 0);

function weighted<T>(w: World, items: T[], weightOf: (item: T) => number, total: number): T {
  let roll = w.r.next() * total;
  for (const item of items) {
    roll -= weightOf(item);
    if (roll < 0) return item;
  }
  return items[items.length - 1]!;
}

/** Each metric's good / needs-improvement boundaries (web.dev thresholds). */
const VITALS = {
  LCP: { good: 2500, poor: 4000, typical: 1700, spread: 1500 },
  INP: { good: 200, poor: 500, typical: 110, spread: 140 },
  CLS: { good: 0.1, poor: 0.25, typical: 0.03, spread: 0.08 },
} as const;

function rating(metric: keyof typeof VITALS, value: number): string {
  const band = VITALS[metric];
  return value <= band.good ? "good" : value <= band.poor ? "needs-improvement" : "poor";
}

async function seedAnalytics(tx: Tx, w: World) {
  type EventRow = typeof analyticsEvents.$inferInsert;
  const events: EventRow[] = [];
  const attributions = new Map<string, typeof analyticsAttributions.$inferInsert>();
  const returning: string[] = [];
  const identified = w.people.slice(0, 60).map((p) => w.contactIds.get(p.key)!);
  let visitorSeq = 0;
  let sessionSeq = 0;

  for (let daysAgo = 178; daysAgo >= 0; daysAgo -= 1) {
    const day = w.daysAgo(daysAgo);
    const weekday = day.getUTCDay();
    const weekdayFactor = [0.75, 1.15, 1.05, 1, 1, 0.95, 0.8][weekday]!;
    // A studio that has been growing: the first month is about two thirds of
    // the latest, under the seasonal curve.
    const growth = 0.65 + 0.35 * ((178 - daysAgo) / 178);
    const sessions = Math.round(34 * w.r.seasonal(day) * weekdayFactor * growth + w.r.int(-4, 4));
    for (let s = 0; s < sessions; s += 1) {
      const reuse = returning.length > 20 && w.r.chance(0.22);
      const anonId = reuse ? w.r.pick(returning) : `demo-v${(visitorSeq++).toString(36).padStart(5, "0")}`;
      if (!reuse && w.r.chance(0.3)) returning.push(anonId);
      const sessionId = `demo-s${(sessionSeq++).toString(36).padStart(6, "0")}`;
      const bot = w.r.chance(0.03);
      const origin = weighted(w, SOURCES, (x) => x.weight, SOURCE_TOTAL);
      const contactId = !bot && w.r.chance(0.05) ? w.r.pick(identified) : null;
      // Visits cluster in the evening, when couples plan weddings.
      const hour = w.r.chance(0.6) ? w.r.int(18, 23) : w.r.int(7, 17);
      let at = new Date(day.getTime());
      at.setUTCHours((hour + 7) % 24, w.r.int(0, 59), w.r.int(0, 59), 0);
      if (at.getTime() > w.now.getTime() - HOUR) at = new Date(w.now.getTime() - w.r.int(65, 600) * 60_000);
      const sessionStart = at;
      const views = bot ? w.r.int(4, 9) : 1 + Math.floor(Math.pow(w.r.next(), 2) * 5);
      let path = origin.landing ?? weighted(w, PATHS, ([, weight]) => weight, PATH_TOTAL)[0];
      const firstPath = path;
      for (let v = 0; v < views; v += 1) {
        events.push({
          anonId,
          sessionId,
          contactId,
          name: "page.viewed",
          path,
          referrer: v === 0 ? origin.referrer : null,
          locale: w.r.chance(0.08) ? "fr-CA" : "en",
          visitorKind: bot ? "bot" : "human",
          botReasons: bot ? ["automation-user-agent"] : [],
          props: v === 0 && origin.touch ? { campaign: origin.touch } : {},
          at,
        });
        at = new Date(at.getTime() + w.r.int(15, 180) * 1000);
        path = weighted(w, PATHS, ([, weight]) => weight, PATH_TOTAL)[0];
      }
      if (!bot && w.r.chance(0.4)) {
        // Web Vitals ride the last page of the visit, as the browser reports
        // them on unload.
        const lastPath = events[events.length - 1]!.path;
        for (const metric of w.r.chance(0.5) ? (["LCP", "CLS"] as const) : (["LCP", "INP"] as const)) {
          const band = VITALS[metric];
          const raw = band.typical + Math.pow(w.r.next(), 3) * band.spread * 2.2;
          const value = metric === "CLS" ? Math.round(raw * 1000) / 1000 : Math.round(raw);
          events.push({
            anonId,
            sessionId,
            contactId,
            name: "web_vital.measured",
            path: lastPath,
            locale: "en",
            props: { metric, value, delta: value, rating: rating(metric, value), navigationType: "navigate" },
            at: new Date(at.getTime() + 2000),
          });
        }
      }
      if (!bot && (firstPath === "/contact" || w.r.chance(0.015))) {
        events.push({
          anonId,
          sessionId,
          contactId,
          name: "form.submitted",
          path: "/contact",
          locale: "en",
          props: { formSlug: "contact" },
          at: new Date(at.getTime() + 60_000),
        });
      }
      if (origin.touch && !bot) {
        const prior = attributions.get(anonId);
        const t = origin.touch;
        attributions.set(anonId, {
          anonId,
          firstSource: prior?.firstSource ?? t.source,
          firstMedium: prior ? prior.firstMedium : t.medium,
          firstCampaign: prior ? prior.firstCampaign : t.campaign,
          firstTerm: prior ? prior.firstTerm : t.term,
          firstContent: prior ? prior.firstContent : t.content,
          firstPath: prior?.firstPath ?? firstPath,
          firstReferrer: prior ? prior.firstReferrer : origin.referrer,
          firstAt: prior?.firstAt ?? sessionStart,
          lastSource: t.source,
          lastMedium: t.medium,
          lastCampaign: t.campaign,
          lastTerm: t.term,
          lastContent: t.content,
          lastPath: firstPath,
          lastReferrer: origin.referrer,
          lastAt: at,
        });
      }
    }
  }
  // Rows inside one day are generated in time order already; the whole set is
  // not, because a returning visitor's later session is pushed after earlier
  // days. Nothing reads insertion order, so no sort is needed.
  await bulk(events, 2500, (chunk) => tx.insert(analyticsEvents).values(chunk));
  const attributionRows = [...attributions.values()];
  await bulk(attributionRows, 2000, (chunk) => tx.insert(analyticsAttributions).values(chunk));
  return {
    analyticsEvents: events.length,
    pageViews: events.filter((e) => e.name === "page.viewed").length,
    webVitals: events.filter((e) => e.name === "web_vital.measured").length,
    attributions: attributionRows.length,
    sessions: sessionSeq,
  };
}

/* ----------------------------------------------------------------- inbox */

type Line = [who: "them" | "us", body: string];

const THREADS: Array<{ subject: string; channel: "email" | "sms" | "chat"; lines: Line[] }> = [
  {
    subject: "Is 14 June next year still open?",
    channel: "email",
    lines: [
      ["them", "Hi! We're getting married at the Tidewater Inn on 14 June next year. Are you still free that day?"],
      ["us", "Congratulations! 14 June is open at the moment. Would a call this week suit you to talk it through?"],
      ["them", "Thursday evening would be perfect. Around 7?"],
      ["us", "Thursday at 7 is in the calendar. I'll send a link the day before."],
    ],
  },
  {
    subject: "Family portraits with a very energetic dog",
    channel: "email",
    lines: [
      ["them", "Can we bring our dog to a beach session? She is friendly but does not sit still."],
      ["us", "Please do. Dogs that don't sit still make the best pictures. Goose Spit at low tide works well for that."],
    ],
  },
  {
    subject: "Running ten minutes late",
    channel: "sms",
    lines: [
      ["them", "So sorry, ferry was late, we'll be there about 10 min after 5."],
      ["us", "No problem at all, the light gets better anyway. See you soon."],
    ],
  },
  {
    subject: "Print sizes for the hallway",
    channel: "chat",
    lines: [
      ["them", "Hello, does the 24x36 print of the driftwood photo come framed?"],
      ["us", "It ships unframed on archival paper, rolled in a tube. Happy to recommend a framer in Courtenay."],
      ["them", "Great, thanks. I'll order it tonight."],
    ],
  },
  {
    subject: "Gallery download question",
    channel: "email",
    lines: [
      ["them", "The gallery link says it expires next month. Can we download everything before then?"],
      ["us", "Yes — the Download all button gives you full-resolution files. I can also extend the link if you need more time."],
      ["them", "Downloaded, thank you! The ones by the water are our favourites."],
    ],
  },
  {
    subject: "Headshots for our team page",
    channel: "email",
    lines: [
      ["them", "We need consistent headshots for six people at the realty office. Do you come on site?"],
      ["us", "I do. Six people is about two hours with a simple backdrop. I'll put a quote together."],
      ["them", "Perfect. Any morning next week works."],
      ["us", "Quote sent — it holds Tuesday morning for seven days."],
    ],
  },
  {
    subject: "Moving our mini session",
    channel: "sms",
    lines: [
      ["them", "Could we move Saturday's mini session to Sunday? Our son has a game."],
      ["us", "Sunday's are fully booked, but next Saturday at 10 is free. Shall I move you there?"],
      ["them", "Yes please!"],
    ],
  },
  {
    subject: "Do you shoot elopements?",
    channel: "chat",
    lines: [
      ["them", "We're thinking of eloping on Mount Washington in February. Is that something you do?"],
      ["us", "Very much so. Winter elopements are some of my favourite days. Half-day coverage starts at $1,600."],
    ],
  },
  {
    subject: "Invoice question",
    channel: "email",
    lines: [
      ["them", "Our invoice shows GST and PST — is the deposit included in that total?"],
      ["us", "The total is before the deposit. The balance due line underneath takes the deposit off."],
    ],
  },
  {
    subject: "Second shooter?",
    channel: "email",
    lines: [
      ["them", "We have about 160 guests. Would we need a second photographer?"],
      ["us", "For 160 I'd suggest one for the ceremony and speeches. It's an add-on on the quote — happy to include it."],
      ["them", "Let's add it, thank you."],
    ],
  },
  {
    subject: "Thank you!",
    channel: "email",
    lines: [["them", "Just wanted to say the photos made my mum cry, in a good way. Thank you so much."]],
  },
  {
    subject: "Gift card for my sister",
    channel: "chat",
    lines: [
      ["them", "Can a gift card be used for a portrait session, or only prints?"],
      ["us", "Either — it works across the shop and sessions."],
    ],
  },
];

async function seedInbox(tx: Tx, w: World) {
  const withPhone = w.people.filter((p) => p.phone);
  const conversationRows: Array<typeof conversations.$inferInsert> = [];
  const scripts: Array<{ person: Person; lines: Line[]; channel: "email" | "sms" | "chat"; times: Date[] }> = [];
  const used = new Set<string>();
  for (let i = 0; i < 30; i += 1) {
    const template = THREADS[i % THREADS.length]!;
    const pool = template.channel === "sms" ? withPhone : w.people;
    let person = w.r.pick(pool);
    while (used.has(person.key)) person = w.r.pick(pool);
    used.add(person.key);
    // Recent threads first: half of the inbox is from the last fortnight.
    const ageDays = i < 15 ? w.r.int(0, 14) : w.r.int(15, 170);
    const start = new Date(w.now.getTime() - ageDays * DAY - w.r.int(1, 20) * HOUR);
    // A thread whose last word is theirs is waiting on the studio.
    const lines = template.lines.slice(0, Math.max(1, template.lines.length - (i < 8 ? 1 : 0)));
    let cursor = start.getTime();
    const times = lines.map((_, n) => {
      if (n > 0) cursor += w.r.int(1, 6) * HOUR;
      return new Date(Math.min(cursor, w.now.getTime() - (lines.length - n) * 60_000));
    });
    scripts.push({ person, lines, channel: template.channel, times });
    const lastInbound = lines.map((l, n) => (l[0] === "them" ? times[n]! : null)).filter(Boolean).at(-1) ?? null;
    const lastOutbound = lines.map((l, n) => (l[0] === "us" ? times[n]! : null)).filter(Boolean).at(-1) ?? null;
    const waiting = lines.at(-1)![0] === "them";
    const status = waiting ? "open" : ageDays > 10 ? "closed" : i % 9 === 0 ? "snoozed" : "open";
    conversationRows.push({
      contactId: w.contactIds.get(person.key)!,
      subject: template.subject,
      replyChannel: template.channel,
      status,
      snoozedUntil: status === "snoozed" ? new Date(w.now.getTime() + 3 * DAY) : null,
      assigneeUserId: i % 3 === 0 ? w.staffUserId : (w.ownerUserId ?? w.staffUserId),
      lastInboundAt: lastInbound,
      lastOutboundAt: lastOutbound,
      // Unread only when they spoke last and recently — the honest inbox.
      unread: waiting && ageDays <= 14,
      messageCount: lines.length,
      createdAt: start,
      updatedAt: times.at(-1)!,
    });
  }
  const opened = await tx.insert(conversations).values(conversationRows).returning({ id: conversations.id });
  const messageRows: Array<typeof messages.$inferInsert> = [];
  scripts.forEach((script, i) => {
    const contactId = w.contactIds.get(script.person.key)!;
    script.lines.forEach(([who, body], n) => {
      const occurredAt = script.times[n]!;
      const outbound = who === "us";
      messageRows.push({
        conversationId: opened[i]!.id,
        contactId,
        direction: outbound ? "outbound" : "inbound",
        channel: script.channel,
        purpose: outbound ? "support" : null,
        body,
        sentBy: outbound ? "user" : "contact",
        sentByUserId: outbound ? conversationRows[i]!.assigneeUserId : null,
        recipientAddress: outbound
          ? script.channel === "sms"
            ? script.person.phone
            : script.channel === "email"
              ? script.person.email
              : null
          : null,
        segments: script.channel === "sms" ? 1 : null,
        costMinor: script.channel === "sms" && outbound ? 1 : null,
        costCurrency: script.channel === "sms" && outbound ? "CAD" : null,
        occurredAt,
        createdAt: occurredAt,
      });
    });
  });
  // The conversation's denormalised timestamps and count were computed from
  // these same times, so the thread and its messages agree.
  await tx.insert(messages).values(messageRows);
  return { conversations: opened.length, messages: messageRows.length };
}

/* --------------------------------------------------------------- members */

const MEMBERS = [
  { handle: "tidepool_tessa", name: "Tessa Larsen", bio: "Sea-glass jewellery from Comox beaches." },
  { handle: "callum_frames", name: "Callum Reid", bio: "Picture framer in Cumberland. I frame Aurora prints." },
  { handle: "mila_ceramics", name: "Mila Poirier", bio: "Wheel-thrown stoneware, glazed the colour of the strait." },
  { handle: "owen_trails", name: "Owen Fraser", bio: "Trail runner and occasional landscape shooter." },
  { handle: "priya_florals", name: "Priya Singh", bio: "Wedding florist. Mostly native greens and dahlias." },
  { handle: "kenji_cycles", name: "Kenji Sato", bio: "Bike mechanic. Rides the Puntledge loop before work." },
  { handle: "amelie_bakes", name: "Amélie Gagnon", bio: "Pâtisserie et gâteaux de mariage, Courtenay." },
  { handle: "jonah_woodwork", name: "Jonah Hughes", bio: "Driftwood frames and small furniture." },
  { handle: "nora_letterpress", name: "Nora Campbell", bio: "Letterpress invitations and stationery." },
  { handle: "rowan_kayaks", name: "Rowan Walsh", bio: "Sea-kayak guide. Knows every cove on Denman." },
  { handle: "elena_studio", name: "Elena Morin", bio: "Hair and makeup for weddings on the Island." },
  { handle: "marco_coffee", name: "Marco Tanaka", bio: "Roaster. Tiny cart at the Saturday market." },
] as const;

const POSTS = [
  "Low tide this morning at Goose Spit — the whole bay turned to glass. #comoxvalley",
  "New batch of mugs out of the kiln. The blue-grey glaze finally behaves.",
  "Framed three of the Aurora Coast prints for a client's hallway today. They look ace together.",
  "Wedding season is wrapping up. Thank you to every couple who trusted us with flowers this year.",
  "Puntledge loop in the fog. Saw two herons and no people.",
  "Testing a new croissant lamination for the market on Saturday. Results: promising.",
  "Shop is open late on Thursday for the print sale at the studio next door.",
  "Paddled out to Sandy Island at sunrise. Highly recommend, bring a thermos.",
  "Finished a set of letterpress invitations in a deep sea green. Very happy with the ink.",
  "Market this weekend: we'll have the new Strait blend and cardamom buns.",
  "Anyone have a recommendation for a portrait photographer? (Asking for my parents' 40th.)",
  "Driftwood frame commission done — six weeks of drying for a two-day build.",
];

const COMMENTS = [
  "Gorgeous.", "Need one of these.", "That light!", "See you Saturday.", "Beautiful work.",
  "Aurora Coast did ours — highly recommend.", "Saving this.", "Can't wait.",
];

async function seedMembers(tx: Tx, w: World) {
  const memberUsers = await tx
    .insert(users)
    .values(MEMBERS.map((m) => ({ email: `member-${m.handle.replaceAll("_", "-")}@demo.freeholder.test`, role: "customer" })))
    .returning({ id: users.id });
  const ids = memberUsers.map((u) => u.id);
  await tx.insert(memberProfiles).values(
    MEMBERS.map((m, i) => ({
      userId: ids[i]!,
      handle: m.handle,
      displayName: m.name,
      bio: m.bio,
      bioVisibility: "public" as const,
      defaultPostVisibility: "public" as const,
      isPrivate: false,
      isAdult: true,
      ageAttestedAt: w.daysAgo(170 - i * 9),
      createdAt: w.daysAgo(170 - i * 9),
    })),
  );
  const follows = new Set<string>();
  const followRows: Array<typeof memberFollows.$inferInsert> = [];
  for (let n = 0; n < 48; n += 1) {
    const a = w.r.int(0, ids.length - 1);
    const b = w.r.int(0, ids.length - 1);
    if (a === b || follows.has(`${a}:${b}`)) continue;
    follows.add(`${a}:${b}`);
    followRows.push({ followerId: ids[a]!, followeeId: ids[b]!, status: "active", createdAt: w.daysAgo(w.r.int(1, 150)) });
  }
  await tx.insert(memberFollows).values(followRows);

  const postRows: Array<typeof memberPosts.$inferInsert> = [];
  for (let n = 0; n < 40; n += 1) {
    const author = n % ids.length;
    postRows.push({
      authorId: ids[author]!,
      body: POSTS[(n * 5 + author) % POSTS.length]!,
      visibility: n % 7 === 0 ? "followers" : "public",
      createdAt: w.daysAgo(Math.max(0, 160 - n * 4 - w.r.int(0, 3)), 9 + (n % 9)),
    });
  }
  const posts = await tx.insert(memberPosts).values(postRows).returning({ id: memberPosts.id, authorId: memberPosts.authorId, createdAt: memberPosts.createdAt });

  const commentRows: Array<typeof memberComments.$inferInsert> = [];
  const reactionRows: Array<typeof memberReactions.$inferInsert> = [];
  const reacted = new Set<string>();
  for (const post of posts) {
    const later = (hours: number) => new Date(Math.min(post.createdAt.getTime() + hours * HOUR, w.now.getTime() - 60_000));
    for (let c = w.r.int(0, 2); c > 0; c -= 1) {
      const author = w.r.pick(ids);
      if (author === post.authorId) continue;
      commentRows.push({ postId: post.id, authorId: author, body: w.r.pick(COMMENTS), createdAt: later(w.r.int(1, 30)) });
    }
    for (let r = w.r.int(0, 5); r > 0; r -= 1) {
      const user = w.r.pick(ids);
      if (user === post.authorId || reacted.has(`${post.id}:${user}`)) continue;
      reacted.add(`${post.id}:${user}`);
      reactionRows.push({ postId: post.id, userId: user, kind: w.r.chance(0.7) ? "like" : "love", createdAt: later(w.r.int(1, 48)) });
    }
  }
  if (commentRows.length) await tx.insert(memberComments).values(commentRows);
  if (reactionRows.length) await tx.insert(memberReactions).values(reactionRows);
  return {
    members: ids.length,
    follows: followRows.length,
    memberPosts: posts.length,
    memberComments: commentRows.length,
    memberReactions: reactionRows.length,
  };
}

/* ----------------------------------------------------------- automations */

const AUTOMATIONS = [
  {
    name: "Welcome new enquiries",
    description: "Notes the source and makes a follow-up task when somebody sends the contact form.",
    triggerKind: "event" as const,
    eventPattern: "form.submitted",
    scheduleCron: null,
    status: "active" as const,
    autonomyCeiling: "autonomous" as const,
    graph: {
      entry: "note",
      maxSteps: 10,
      nodes: [
        { kind: "call", id: "note", label: "Note the enquiry", verb: "contacts.note", params: { body: "New enquiry from the contact form." }, next: "task" },
        { kind: "call", id: "task", label: "Reply within a day", verb: "tasks.create", params: { title: "Reply to the new enquiry", dueInDays: 1 }, next: null },
      ],
    },
  },
  {
    name: "Gallery delivered follow-up",
    description: "Two weeks after a gallery goes out, drafts a check-in and asks before sending.",
    triggerKind: "event" as const,
    eventPattern: "galleries.delivered",
    scheduleCron: null,
    status: "active" as const,
    autonomyCeiling: "approve" as const,
    graph: {
      entry: "wait",
      maxSteps: 10,
      nodes: [
        { kind: "wait", id: "wait", label: "Two weeks", minutes: 20160, next: "draft" },
        { kind: "prompt", id: "draft", label: "Draft a check-in", brief: "Write a short, warm note asking how they are finding the gallery and whether they would like prints.", outputKey: "note", next: "gate" },
        { kind: "gate", id: "gate", reason: "Read the note before it goes to the client.", next: "stage" },
        { kind: "call", id: "stage", verb: "contacts.setStage", params: { stage: "customer" }, next: null },
      ],
    },
  },
  {
    name: "Overdue invoice nudge",
    description: "Every weekday morning, lines up a polite reminder for each invoice more than a week overdue.",
    triggerKind: "schedule" as const,
    eventPattern: null,
    scheduleCron: "0 9 * * 1-5",
    status: "active" as const,
    autonomyCeiling: "approve" as const,
    graph: {
      entry: "draft",
      maxSteps: 10,
      nodes: [
        { kind: "prompt", id: "draft", label: "Draft the reminder", brief: "Draft a friendly payment reminder naming the invoice number and amount due.", outputKey: "reminder", next: "gate" },
        { kind: "gate", id: "gate", reason: "Money: always ask first.", next: null },
      ],
    },
  },
  {
    name: "Anniversary print offer",
    description: "A year after the wedding, suggests an anniversary print. Paused until the first anniversaries arrive.",
    triggerKind: "event" as const,
    eventPattern: "bookings.completed",
    scheduleCron: null,
    status: "paused" as const,
    autonomyCeiling: "suggest" as const,
    graph: {
      entry: "wait",
      maxSteps: 5,
      nodes: [
        { kind: "wait", id: "wait", minutes: 525600, next: "note" },
        { kind: "call", id: "note", verb: "contacts.note", params: { body: "Anniversary coming up — suggest a print." }, next: null },
      ],
    },
  },
];

async function seedAutomations(tx: Tx, w: World) {
  const author = w.ownerUserId ?? w.staffUserId;
  const made = await tx
    .insert(automations)
    .values(
      AUTOMATIONS.map((a, i) => ({
        name: a.name,
        description: a.description,
        triggerKind: a.triggerKind,
        eventPattern: a.eventPattern,
        scheduleCron: a.scheduleCron,
        timezone: a.scheduleCron ? "America/Vancouver" : null,
        status: a.status,
        draftGraph: a.graph,
        autonomyCeiling: a.autonomyCeiling,
        reentry: "always" as const,
        createdByUserId: author,
        createdAt: w.daysAgo(150 - i * 25),
        updatedAt: w.daysAgo(140 - i * 25),
      })),
    )
    .returning({ id: automations.id });
  const versions = await tx
    .insert(automationVersions)
    .values(
      AUTOMATIONS.map((a, i) => ({
        automationId: made[i]!.id,
        version: 1,
        graph: a.graph,
        note: "First published version.",
        triggerKind: a.triggerKind,
        eventPattern: a.eventPattern,
        scheduleCron: a.scheduleCron,
        createdByUserId: author,
        createdAt: w.daysAgo(149 - i * 25),
      })),
    )
    .returning({ id: automationVersions.id });

  const runRows: Array<typeof runs.$inferInsert> = [];
  const runMeta: Array<{ automation: number; failed: boolean }> = [];
  const states = new Map<string, { automationId: string; contactId: string; entryCount: number; lastEnteredAt: Date }>();
  const quota = [70, 24, 30, 0];
  for (const [index, total] of quota.entries()) {
    for (let n = 0; n < total; n += 1) {
      const person = w.r.pick(w.people);
      const contactId = w.contactIds.get(person.key)!;
      const daysAgo = Math.floor((n / total) * (140 - index * 25)) + 1;
      const startedAt = w.daysAgo(daysAgo, w.r.int(8, 20));
      // Exactly one failure, on the enquiry automation, so the run history
      // shows what a failure looks like without the studio looking broken.
      const failed = index === 0 && n === 41;
      const endedAt = new Date(startedAt.getTime() + w.r.int(1, 20) * 1000);
      runRows.push({
        subjectKind: "automation",
        subjectId: made[index]!.id,
        subjectVersionId: versions[index]!.id,
        contactId,
        status: failed ? "failed" : "done",
        startedAt,
        endedAt,
        stopReason: failed ? "error" : "done",
        error: failed ? "contacts.note: the contact was merged while this run was waiting." : null,
        stepCount: failed ? 1 : AUTOMATIONS[index]!.graph.nodes.length,
        tokensIn: AUTOMATIONS[index]!.graph.nodes.some((node) => node.kind === "prompt") ? w.r.int(300, 900) : 0,
        tokensOut: AUTOMATIONS[index]!.graph.nodes.some((node) => node.kind === "prompt") ? w.r.int(80, 240) : 0,
        createdAt: startedAt,
        updatedAt: endedAt,
      });
      runMeta.push({ automation: index, failed });
      const key = `${index}:${contactId}`;
      const prior = states.get(key);
      states.set(key, {
        automationId: made[index]!.id,
        contactId,
        entryCount: (prior?.entryCount ?? 0) + 1,
        lastEnteredAt: startedAt,
      });
    }
  }
  const inserted = await tx.insert(runs).values(runRows).returning({ id: runs.id });
  const stepRows: Array<typeof runSteps.$inferInsert> = [];
  inserted.forEach((run, i) => {
    const meta = runMeta[i]!;
    const graph = AUTOMATIONS[meta.automation]!.graph;
    const nodes = meta.failed ? graph.nodes.slice(0, 1) : graph.nodes;
    nodes.forEach((node, seq) => {
      stepRows.push({
        runId: run.id,
        seq,
        kind: node.kind as "call",
        nodeId: node.id,
        serviceName: node.kind === "call" ? (node as { verb: string }).verb : null,
        durationMs: w.r.int(12, 900),
        error: meta.failed ? runRows[i]!.error : null,
        createdAt: runRows[i]!.startedAt,
      });
    });
  });
  await bulk(stepRows, 2000, (chunk) => tx.insert(runSteps).values(chunk));
  await tx.insert(automationContactState).values(
    [...states.values()].map((s) => ({ ...s, createdAt: s.lastEnteredAt, updatedAt: s.lastEnteredAt })),
  );
  await tx
    .update(automations)
    .set({ currentVersionId: versions[0]!.id, lastRunAt: runRows.filter((r) => r.subjectId === made[0]!.id).at(-1)!.startedAt })
    .where(eqId(made[0]!.id));
  for (let i = 1; i < made.length; i += 1) {
    const last = runRows.filter((r) => r.subjectId === made[i]!.id).at(-1)?.startedAt ?? null;
    await tx
      .update(automations)
      .set({
        currentVersionId: versions[i]!.id,
        lastRunAt: last,
        nextRunAt: AUTOMATIONS[i]!.scheduleCron ? w.daysAhead(1, 9) : null,
      })
      .where(eqId(made[i]!.id));
  }

  // Two reminders waiting on a person: the "approve" rung of the ladder,
  // visible in the approvals queue the moment somebody opens it.
  const pending = runRows
    .map((row, i) => ({ row, id: inserted[i]!.id }))
    .filter(({ row }) => row.subjectId === made[2]!.id)
    .slice(-2);
  await tx.insert(runApprovals).values(
    pending.map(({ row, id }, n) => ({
      runId: id,
      subjectKind: "automation" as const,
      subjectId: made[2]!.id,
      kind: "gate",
      summary: n === 0 ? "Send a payment reminder for invoice ACP-0142 ($612.50 due)" : "Send a payment reminder for invoice ACP-0151 ($225.00 due)",
      preview: { channel: "email", body: "Hello — a gentle reminder that this invoice is now a week past due. Thank you!" },
      serviceName: "invoicing.scheduleReminders",
      input: { contactId: row.contactId },
      proposedAutonomy: "approve" as const,
      status: "pending" as const,
      expiresAt: w.daysAhead(5),
      createdAt: w.daysAgo(n),
      updatedAt: w.daysAgo(n),
    })),
  );
  // Those two runs are waiting at the gate rather than finished.
  for (const { id } of pending) {
    await tx.update(runs).set({ status: "running", endedAt: null, stopReason: null, resumeNodeId: "gate" }).where(eqRun(id));
  }
  return {
    automations: made.length,
    automationRuns: inserted.length,
    runSteps: stepRows.length,
    pendingApprovals: pending.length,
  };
}

const eqId = (id: string) => eq(automations.id, id);
const eqRun = (id: string) => eq(runs.id, id);

/* ------------------------------------------------------------- audit log */

const AUDIT_ACTIONS: Array<{ action: string; subject: "contact" | "page" | "invoice" | "product" | "booking" }> = [
  { action: "contacts.update", subject: "contact" },
  { action: "contacts.create", subject: "contact" },
  { action: "notes.write", subject: "contact" },
  { action: "tasks.setStatus", subject: "contact" },
  { action: "cms.updatePage", subject: "page" },
  { action: "cms.publishPage", subject: "page" },
  { action: "invoicing.issueInvoice", subject: "invoice" },
  { action: "invoicing.recordPayment", subject: "invoice" },
  { action: "catalog.updateProduct", subject: "product" },
  { action: "bookings.setStatus", subject: "booking" },
  { action: "bookings.reschedule", subject: "booking" },
];

async function seedAudit(tx: Tx, w: World) {
  const actors = [w.staffUserId, ...(w.ownerUserId ? [w.ownerUserId] : [])];
  const rows: Array<typeof auditLog.$inferInsert> = [];
  for (let n = 0; n < 360; n += 1) {
    const entry = w.r.pick(AUDIT_ACTIONS);
    const person = w.r.pick(w.people);
    const actor = actors[n % 5 === 0 || actors.length === 1 ? 0 : 1]!;
    rows.push({
      actor: `user:${actor}`,
      action: entry.action,
      subjectType: entry.subject,
      subjectId: entry.subject === "contact" ? w.contactIds.get(person.key)! : null,
      diff: entry.subject === "contact" ? { name: person.name } : {},
      at: new Date(w.now.getTime() - Math.floor(Math.pow(w.r.next(), 1.3) * 178 * DAY) - w.r.int(1, 600) * 60_000),
    });
  }
  await tx.insert(auditLog).values(rows);

  const recipient = w.ownerUserId ?? w.staffUserId;
  const notes = [
    { topic: "forms.submitted", title: "New enquiry from the contact form", body: "Somebody asked about a June wedding.", href: "/admin/contacts", days: 0 },
    { topic: "invoicing.paid", title: "Invoice paid", body: "A portrait session invoice was paid in full.", href: "/admin/invoices", days: 1 },
    { topic: "bookings.created", title: "New booking", body: "A mini session was booked for next Saturday.", href: "/admin/bookings", days: 2 },
    { topic: "automations.approval", title: "Two reminders waiting for you", body: "The overdue invoice nudge drafted two reminders.", href: "/admin/automations", days: 0 },
    { topic: "reviews.received", title: "New five-star review", body: "A client left a review after their gallery.", href: "/admin/reviews", days: 4 },
  ];
  await tx.insert(notifications).values(
    notes.map((note, i) => {
      const at = new Date(w.now.getTime() - note.days * DAY - (i + 1) * HOUR);
      return {
        recipientUserId: recipient,
        topic: note.topic,
        title: note.title,
        body: note.body,
        href: note.href,
        idempotencyKey: `busy-demo:${note.topic}:${i}`,
        firstOccurredAt: at,
        lastOccurredAt: at,
        readAt: note.days > 1 ? new Date(at.getTime() + HOUR) : null,
        createdAt: at,
        updatedAt: at,
      };
    }),
  );
  return { auditLog: rows.length, notifications: notes.length };
}

export const seedActivity: AreaSeeder = async (tx, w) => ({
  ...(await seedAnalytics(tx, w)),
  ...(await seedInbox(tx, w)),
  ...(await seedMembers(tx, w)),
  ...(await seedAutomations(tx, w)),
  ...(await seedAudit(tx, w)),
});
