// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What the studio has published and what people said back (C1.38 busy demo):
// the journal, client galleries with proofing rounds, reviews, the letter's
// sent issues and its subscribers, enquiries through the contact form, and the
// popup that invites people to the letter.
//
// Bulk inserts that write exactly the rows the owning services would: a post
// is a published CMS page under `blog/` with its create and publish
// revisions; a sent issue is a published issue with its archive page and a
// broadcast whose recipients were all confirmed subscribers on the day it
// went; consent evidence precedes every send and an unsubscribe is recorded
// as a withdrawal. Open and click counts are not invented — the platform only
// counts what it recorded (§30), so broadcasts carry delivery states.
import { eq, like } from "drizzle-orm";
import { assets } from "@/core/media/schema";
import { timelineEvents } from "@/core/contacts/schema";
import { consentRecords } from "@/core/privacy/schema";
import { segmentMembers, segments } from "@/core/segments/schema";
import { contentRevisions, pages } from "@/modules/cms/schema";
import { parseBlockTree } from "@/modules/cms/blocks/registry";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { forms, formSubmissions } from "@/modules/forms/schema";
import {
  galleries,
  galleryAccessLogs,
  galleryItems,
  galleryRounds,
  gallerySelections,
} from "@/modules/galleries/schema";
import {
  newsletterIssues,
  newsletters,
  newsletterSubscriptions,
} from "@/modules/newsletters/schema";
import { broadcastRecipients, broadcasts } from "@/modules/newsletters/broadcast-schema";
import { emailTemplates } from "@/modules/newsletters/template-schema";
import { popupEvents, popups } from "@/modules/popups/schema";
import { reviews } from "@/modules/reviews/schema";
import type { Tx } from "@/core/service";
import { DAY, HOUR, type AreaSeeder, type World } from "./world";

type Timeline = typeof timelineEvents.$inferInsert;

/** Deterministic hex from the seeded generator, for tokens and visitor keys. */
function hex(w: World, length: number): string {
  let out = "";
  while (out.length < length) out += Math.floor(w.r.next() * 0x100000000).toString(16).padStart(8, "0");
  return out.slice(0, length);
}

/** Nothing in the sample business happens after the seed's own clock. */
function past(w: World, at: Date): Date {
  return at > w.now ? w.now : at;
}

function staffActor(w: World): string {
  return `user:${w.ownerUserId ?? w.staffUserId}`;
}

/* ------------------------------------------------------------------ journal */

interface Post {
  slug: string;
  title: string;
  seoTitle: string;
  description: string;
  daysAgo: number;
  paragraphs: string[];
}

/**
 * The studio journal. Written as the photographer would write it: specific,
 * local, and useful to the person deciding whether to book.
 */
export const POSTS: Post[] = [
  {
    slug: "reading-the-tide-table",
    title: "Reading the tide table before a beach session",
    seoTitle: "Reading the tide table before a beach session",
    description: "Why every beach portrait on this coast starts with the tide table, and how a two-metre swing changes where we stand and what the light does.",
    daysAgo: 171,
    paragraphs: [
      "Before I look at the weather, I look at the tide. On the Comox side of the strait a summer tide can swing more than four metres between morning and evening, and that decides everything: whether there is sand to stand on, whether the rocks at Goose Spit are dry, and whether the light bounces off wet flats or open water.",
      "Low tide in the last hour before sunset is the one I hope for. The flats turn into a mirror, the sky doubles, and everyone looks taller than they are. A high tide at the same hour is still beautiful — it just means we work the logs and the grass above the line instead.",
      "If you have booked a beach session, I will send you the tide time with the confirmation. If it moves the start by half an hour, that half hour is worth it.",
    ],
  },
  {
    slug: "what-to-wear-for-coastal-portraits",
    title: "What to wear for coastal portraits",
    seoTitle: "What to wear for coastal portraits",
    description: "Soft colours, real shoes and one warm layer: a short guide to dressing for a portrait session on a windy Vancouver Island beach.",
    daysAgo: 149,
    paragraphs: [
      "Wear what you would wear on a good day off. That is the whole rule, and everything else is detail.",
      "The detail: colours that sit near the landscape — sand, slate, moss, a muted blue — photograph better than brand-new brights. Pattern is fine if it is small. Bring a warm layer even in August, because the wind off the strait arrives at the exact moment the light gets good.",
      "And wear shoes you can walk in. We usually cover a kilometre of beach in ninety minutes, and nobody relaxes in shoes they are worried about.",
    ],
  },
  {
    slug: "a-september-wedding-at-the-boatyard",
    title: "A September wedding at the boatyard",
    seoTitle: "A September wedding at the boatyard",
    description: "Rain in the morning, a ferry delay and the best eleven minutes of light all year: notes from a small September wedding on the water.",
    daysAgo: 127,
    paragraphs: [
      "It rained until two. The ferry carrying half the guests was forty minutes late. The couple laughed about both, which is the only correct response and the reason the day went well.",
      "We did the portraits in the boat shed while the rain finished, using the big doors as a softbox. Then, at 6:40, the cloud lifted off the Beaufort Range and the whole bay went copper for eleven minutes. We ran.",
      "Those eleven minutes are on their wall now. The rainy boat-shed frames are on their parents' wall. Both are true pictures of the day.",
    ],
  },
  {
    slug: "caring-for-your-prints",
    title: "Caring for your prints",
    seoTitle: "Caring for your fine art prints",
    description: "How to hang, light and store archival pigment prints so they look the same in thirty years — including what salt air does to a frame.",
    daysAgo: 104,
    paragraphs: [
      "Every print from the studio is pigment ink on cotton rag paper, rated to last well past any of us if it is treated kindly.",
      "Kindly means out of direct sun, away from a bathroom's steam, and — on this coast — not on a wall that faces the sea with the window open all summer. Salt air is hard on metal frames and harder on the backing board behind them.",
      "Handle unframed prints by the edges with clean, dry hands, and store them flat in the sleeve they arrived in. If something goes wrong, write to me: reprints of anything you bought are at cost.",
    ],
  },
  {
    slug: "behind-the-scenes-editing-a-gallery",
    title: "Behind the scenes: editing a gallery",
    seoTitle: "Behind the scenes: how a gallery gets edited",
    description: "From two thousand frames to two hundred: what happens in the three weeks between a wedding and the gallery link arriving in your inbox.",
    daysAgo: 83,
    paragraphs: [
      "A wedding day is usually around two thousand frames. The gallery you receive is around two hundred and fifty. The difference is not deletion for its own sake; it is choosing the frame where everybody's eyes are open and the moment actually happened.",
      "The first pass is fast and ruthless. The second is slow and happens a day later, with fresh eyes. Colour is done last, in batches by light, so the ceremony under cloud and the dinner under string lights each look like themselves.",
      "Then the gallery goes up with proofing switched on, so you can favourite the frames you want printed before anything is final.",
    ],
  },
  {
    slug: "winter-light-on-the-strait",
    title: "Winter light on the strait",
    seoTitle: "Winter light on the strait",
    description: "Low sun, short days and fog that arrives on schedule: why the off-season is quietly the best time of year for portraits on the coast.",
    daysAgo: 61,
    paragraphs: [
      "Everyone books summer. Winter is the secret.",
      "From November to February the sun never climbs high, so the light is soft and sideways all day rather than for one golden hour. Fog rolls in off the strait most mornings and burns off by eleven, which gives us two completely different sessions for the price of one walk.",
      "Off-season sessions also come with the print credit, which makes the arithmetic as good as the light.",
    ],
  },
  {
    slug: "choosing-a-venue-for-the-light",
    title: "Choosing a venue for the light",
    seoTitle: "Choosing a wedding venue for the light",
    description: "Which way the windows face, where the sun sets in your month, and the question to ask every venue before you sign anything.",
    daysAgo: 42,
    paragraphs: [
      "When couples ask which venue photographs best, my answer is a question: which way do the windows face, and what time is dinner?",
      "A west-facing room with dinner at seven in July will glow. The same room with dinner at five will be flat until dessert. A north-facing hall is wonderfully even all day and never dramatic.",
      "Ask the venue for a photo of the room at the hour you will be in it. If they do not have one, I can usually tell you, because I have probably stood there.",
    ],
  },
  {
    slug: "the-print-wall-this-season",
    title: "The print wall this season",
    seoTitle: "New prints on the studio wall this season",
    description: "Three new limited prints from the past year on the coast, what each one took to make, and how the studio's print sizes were chosen.",
    daysAgo: 24,
    paragraphs: [
      "Three new prints went up on the studio's north wall this month: Driftwood at Dawn, The Strait in Fog, and The Headland at Low Tide.",
      "Each is available in three sizes. The smallest suits a shelf or a stack of books; the largest wants a wall of its own and at least two metres of distance to be read properly.",
      "All three are in the shop, and the studio is open on Saturday mornings if you would rather see them in person first.",
    ],
  },
  {
    slug: "booking-mini-sessions",
    title: "How mini sessions work",
    seoTitle: "How mini sessions work at Aurora Coast",
    description: "Thirty minutes, one location, a handful of finished photographs: who mini sessions suit, and who should book the full ninety minutes instead.",
    daysAgo: 9,
    paragraphs: [
      "A mini session is thirty minutes in one place, usually the beach below the studio, and ends with a small set of finished photographs.",
      "They suit a quick family update, a new headshot, or a dog who will not sit still for longer anyway. They do not suit a first family session with small children, who need the full ninety minutes to forget the camera exists.",
      "Mini session dates open on the booking page a month ahead and tend to go within the week.",
    ],
  },
];

function postBlocks(post: Post): BlockNode[] {
  return parseBlockTree(
    [
      { id: "post-h1", type: "heading", props: { text: post.title, level: 1, align: "start" } },
      ...post.paragraphs.map((body, index) => ({
        id: `post-p${index + 1}`,
        type: "text",
        props: { body, align: "start", measure: true },
      })),
      { id: "post-cta", type: "button", props: { label: "Book a session", href: "/contact", variant: "quiet" } },
    ],
    "page",
  );
}

/** A page as `cms.createPage` then `cms.publishPage` leave it, at a past moment. */
async function insertPublishedPage(
  tx: Tx,
  input: { slug: string; title: string; blocks: BlockNode[]; seo: Record<string, string>; at: Date; actor: string },
): Promise<string> {
  const [page] = await tx
    .insert(pages)
    .values({
      slug: input.slug,
      locale: "en",
      title: input.title,
      blocks: input.blocks,
      seo: input.seo,
      status: "published",
      publishedAt: input.at,
      workingTitle: input.title,
      workingBlocks: input.blocks,
      workingSeo: input.seo,
      version: 2,
      createdAt: new Date(input.at.getTime() - 2 * HOUR),
      updatedAt: input.at,
    })
    .onConflictDoNothing({ target: [pages.slug, pages.locale] })
    .returning({ id: pages.id });
  if (!page) return "";
  await tx.insert(contentRevisions).values([
    {
      subjectType: "page",
      subjectId: page.id,
      title: input.title,
      blocks: input.blocks,
      seo: input.seo,
      kind: "create",
      actor: input.actor,
      createdAt: new Date(input.at.getTime() - 2 * HOUR),
    },
    {
      subjectType: "page",
      subjectId: page.id,
      title: input.title,
      blocks: input.blocks,
      seo: input.seo,
      kind: "publish",
      name: "Published",
      actor: input.actor,
      createdAt: input.at,
    },
  ]);
  return page.id;
}

async function seedJournal(tx: Tx, w: World): Promise<number> {
  let written = 0;
  for (const post of POSTS) {
    const id = await insertPublishedPage(tx, {
      slug: `blog/${post.slug}`,
      title: post.title,
      blocks: postBlocks(post),
      seo: { title: post.seoTitle, description: post.description },
      at: w.daysAgo(post.daysAgo, 9),
      actor: staffActor(w),
    });
    if (id) written += 1;
  }
  return written;
}

/* ---------------------------------------------------------------- galleries */

const GALLERY_TITLES = [
  "Beach portraits at Goose Spit",
  "Wedding at the boatyard",
  "Family session, Kye Bay",
  "Headshots in the studio",
  "Engagement walk, Comox Marina",
] as const;

function slugOf(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function seedGalleries(tx: Tx, w: World, timeline: Timeline[]) {
  const images = await tx
    .select({ id: assets.id })
    .from(assets)
    .where(like(assets.mime, "image/%"))
    .orderBy(assets.createdAt);
  if (images.length === 0) return { galleries: 0, selections: 0 };

  const clients = w.people.filter((p) => p.lifecycle === "customer" || p.lifecycle === "repeat");
  const actor = staffActor(w);
  let selectionCount = 0;
  const made: string[] = [];
  for (let i = 0; i < GALLERY_TITLES.length && i < clients.length; i += 1) {
    const person = clients[(i * 7) % clients.length]!;
    const contactId = w.contactIds.get(person.key)!;
    const createdAt = w.daysAgo(Math.max(3, Math.min(person.firstSeenDaysAgo, 150) - 10 - i * 4), 10);
    const title = `${GALLERY_TITLES[i]} — ${person.first}`;
    const [gallery] = await tx
      .insert(galleries)
      .values({
        contactId,
        title,
        slug: slugOf(`${GALLERY_TITLES[i]} ${person.name}`),
        kind: "client_delivery",
        coverAssetId: images[i % images.length]!.id,
        // Login-gated: no shared secret to invent, and the client signs in
        // with the magic link they already use for invoices.
        access: "login",
        downloadPolicy: i % 2 === 0 ? "web_res" : "full_res",
        createdByUserId: w.ownerUserId ?? w.staffUserId,
        createdAt,
        updatedAt: createdAt,
      })
      .returning({ id: galleries.id });
    made.push(gallery!.id);
    await tx.insert(galleryItems).values(
      images.map((image, position) => ({ galleryId: gallery!.id, assetId: image.id, position })),
    );
    timeline.push({
      contactId,
      actor,
      eventType: "gallery.created",
      subjectType: "gallery",
      subjectId: gallery!.id,
      occurredAt: createdAt,
    });

    const viewedAt = past(w, new Date(createdAt.getTime() + 6 * HOUR));
    await tx.insert(galleryAccessLogs).values(
      Array.from({ length: 3 + i }, (_, n) => ({
        galleryId: gallery!.id,
        contactId,
        action: "view" as const,
        at: past(w, new Date(viewedAt.getTime() + n * DAY)),
      })),
    );

    // Proofing on the first three: one approved, one submitted and waiting
    // on the owner, one still being chosen.
    if (i < 3) {
      const chosen = images.slice(0, Math.max(1, Math.ceil(images.length * 0.6)));
      const selections = chosen.map((image, n) => ({
        galleryId: gallery!.id,
        contactId,
        assetId: image.id,
        kind: n === chosen.length - 1 && chosen.length > 1 ? ("reject" as const) : n % 3 === 0 ? ("favorite" as const) : ("select" as const),
        comment: n === 0 ? "This one for the hallway, please — the big size." : null,
        createdAt: past(w, new Date(viewedAt.getTime() + HOUR)),
        updatedAt: past(w, new Date(viewedAt.getTime() + HOUR)),
      }));
      await tx.insert(gallerySelections).values(selections);
      selectionCount += selections.length;
      for (const selection of selections) {
        timeline.push({
          contactId,
          actor: "anonymous",
          eventType: "gallery.selected",
          subjectType: "gallery",
          subjectId: gallery!.id,
          payload: { assetId: selection.assetId, kind: selection.kind },
          occurredAt: selection.createdAt,
        });
      }
      const snapshot = selections.map((s) => ({ assetId: s.assetId, kind: s.kind, comment: s.comment }));
      const submittedAt = past(w, new Date(viewedAt.getTime() + DAY));
      if (i === 0) {
        const decidedAt = past(w, new Date(submittedAt.getTime() + DAY));
        await tx.insert(galleryRounds).values({
          galleryId: gallery!.id,
          sequence: 1,
          state: "approved",
          submittedByContactId: contactId,
          note: "Lovely choices. Prints go to the lab on Monday.",
          snapshot,
          submittedAt,
          decidedAt,
        });
        timeline.push(
          { contactId, actor: "anonymous", eventType: "gallery.roundSubmitted", subjectType: "gallery", subjectId: gallery!.id, payload: { sequence: 1, chosen: snapshot.length }, occurredAt: submittedAt },
          { contactId, actor, eventType: "gallery.roundApproved", subjectType: "gallery", subjectId: gallery!.id, payload: { sequence: 1 }, occurredAt: decidedAt },
        );
      } else if (i === 1) {
        await tx.insert(galleryRounds).values({
          galleryId: gallery!.id,
          sequence: 1,
          state: "submitted",
          submittedByContactId: contactId,
          snapshot,
          submittedAt,
        });
        timeline.push({ contactId, actor: "anonymous", eventType: "gallery.roundSubmitted", subjectType: "gallery", subjectId: gallery!.id, payload: { sequence: 1, chosen: snapshot.length }, occurredAt: submittedAt });
      } else {
        await tx.insert(galleryRounds).values({ galleryId: gallery!.id, sequence: 1, state: "open" });
      }
    }
  }
  return { galleries: made.length, selections: selectionCount };
}

/* ------------------------------------------------------------------ reviews */

const REVIEW_COPY: Array<{ rating: number; title: string; body: string }> = [
  { rating: 5, title: "Worth every minute of the walk", body: "We were nervous about being photographed and forgot about it within ten minutes. The gallery arrived early and my mother cried at the first page." },
  { rating: 5, title: "The rain pictures are the best ones", body: "It poured on our wedding day. We have the most beautiful rainy boat-shed photographs anyone has ever seen." },
  { rating: 5, title: "Patient with our toddler", body: "Ninety minutes, one very unimpressed two-year-old, and somehow twenty frames we will frame. Calm and kind the whole time." },
  { rating: 5, title: "Prints are stunning", body: "Bought the large Strait in Fog print for the living room. The paper is gorgeous and it arrived packed like it was going to the moon." },
  { rating: 4, title: "Lovely session, tight schedule", body: "Beautiful photographs and easy to work with. We ran out of light a little sooner than hoped, but the tide advice was spot on." },
  { rating: 5, title: "Headshots I actually like", body: "First headshot in ten years I did not immediately want to replace. Quick, relaxed, and the retouching is subtle." },
  { rating: 5, title: "Knows every beach", body: "Suggested a spot we had never heard of, twenty minutes from our house. It was perfect." },
  { rating: 4, title: "Great experience", body: "Clear pricing, a friendly pre-shoot call and a gallery within three weeks as promised. Would book again." },
  { rating: 5, title: "Captured my dad perfectly", body: "My father hates cameras. There is one of him laughing at the dog that we will treasure forever." },
  { rating: 3, title: "Good photos, slow reply", body: "The photographs are lovely, but it took a few days to hear back about an extra print size." },
  { rating: 5, title: "Felt like a walk with a friend", body: "No awkward posing at all. We walked, talked, and the pictures happened around us." },
  { rating: 5, title: "Engagement session magic", body: "Comox Marina at sunset. Every frame looks like us on a good day, which is the highest praise I have." },
  { rating: 4, title: "Very happy", body: "Good communication, beautiful results. Parking near the studio was the only hiccup." },
  { rating: 5, title: "Proofing was easy", body: "Picking our favourites online was simple, and the prints we chose arrived within a week." },
  { rating: 5, title: "Would recommend to anyone", body: "Professional, warm and genuinely talented. Our family photos have never looked this natural." },
  { rating: 3, title: "Nice but not for us", body: "The photographs are well made; the natural style just turned out not to be what my partner pictured. Our fault for not asking more questions." },
  { rating: 5, title: "Mini session, maximum result", body: "Thirty minutes on the beach and we came away with our Christmas card and a print for Grandma." },
  { rating: 5, title: "Beautiful winter portraits", body: "Booked in the off-season on a foggy morning. Moody, soft, exactly what we hoped for — and the print credit helped." },
  { rating: 4, title: "Lovely work", body: "Our wedding gallery is beautiful. A couple of family group shots were a little rushed, but the candids more than make up for it." },
  { rating: 5, title: "Five stars", body: "Easy booking, great conversation, and photographs we will keep for the rest of our lives." },
];

const OWNER_REPLIES: Record<number, string> = {
  9: "Thank you — and you are right, that reply should have been faster. Extra print sizes now go out the same day.",
  15: "Thank you for saying so honestly. A short call about style before booking is now part of every enquiry.",
};

async function seedReviews(tx: Tx, w: World, timeline: Timeline[]) {
  const clients = w.people.filter((p) => p.lifecycle === "customer" || p.lifecycle === "repeat");
  const replier = w.ownerUserId ?? w.staffUserId;
  const rows: Array<typeof reviews.$inferInsert> = [];
  REVIEW_COPY.forEach((copy, index) => {
    const person = clients[(index * 11 + 3) % clients.length]!;
    const ageDays = Math.max(1, Math.min(person.firstSeenDaysAgo, 170) - w.r.int(5, 25));
    const at = w.daysAgo(ageDays, 19);
    // The newest two are still waiting to be read; everything else has been
    // looked at, and the low ratings are on the wall with a public answer.
    const pending = index >= REVIEW_COPY.length - 2;
    const reply = OWNER_REPLIES[index];
    const replyAt = past(w, new Date(at.getTime() + DAY));
    rows.push({
      contactId: w.contactIds.get(person.key)!,
      displayName: `${person.first} ${person.name.split(" ").at(-1)!.charAt(0)}.`,
      source: index % 4 === 0 ? "manual" : "post_booking",
      subjectType: "business",
      rating: copy.rating,
      title: copy.title,
      body: copy.body,
      status: pending ? "pending" : "approved",
      displayLocations: pending ? [] : copy.rating >= 4 ? ["home", "services"] : ["services"],
      replyBody: reply ?? null,
      replyAt: reply ? replyAt : null,
      replyByUserId: reply ? replier : null,
      moderatedAt: pending ? null : past(w, new Date(at.getTime() + 4 * HOUR)),
      moderatedByUserId: pending ? null : replier,
      createdAt: at,
      updatedAt: reply ? replyAt : at,
    });
  });
  const inserted = await tx.insert(reviews).values(rows).returning({ id: reviews.id });
  inserted.forEach((review, index) => {
    const row = rows[index]!;
    timeline.push({
      contactId: row.contactId!,
      actor: "anonymous",
      eventType: "review.submitted",
      subjectType: "review",
      subjectId: review.id,
      payload: { rating: row.rating },
      occurredAt: row.createdAt,
    });
    if (row.replyBody) {
      timeline.push({
        contactId: row.contactId!,
        actor: `user:${replier}`,
        eventType: "review.replied",
        subjectType: "review",
        subjectId: review.id,
        occurredAt: row.replyAt!,
      });
    }
  });
  return inserted.length;
}

/* --------------------------------------------------------------- newsletter */

const ISSUES = [
  { slug: "spring-tides-and-new-dates", title: "Spring tides and new dates", daysAgo: 152, excerpt: "The big low tides are back, and so are evening beach sessions.", body: "The first big low tides of spring arrive this month, which means evening sessions on the flats are open again.\n\nDates are on the booking page. The Saturday ones go first." },
  { slug: "wedding-season-notes", title: "Notes from the start of wedding season", daysAgo: 113, excerpt: "Three weddings in, one ferry missed, and a reminder about timelines.", body: "Three weddings into the season and the light has been kind.\n\nIf your day is coming up, this is your reminder to send the timeline two weeks ahead, so we can move portraits to the best eleven minutes of the evening." },
  { slug: "three-new-prints", title: "Three new prints on the wall", daysAgo: 71, excerpt: "Driftwood at Dawn, The Strait in Fog and The Headland at Low Tide.", body: "Three new prints are on the studio wall and in the shop: Driftwood at Dawn, The Strait in Fog, and The Headland at Low Tide.\n\nThe studio is open Saturday mornings if you would like to see them in person." },
  { slug: "off-season-sessions-open", title: "Off-season sessions are open", daysAgo: 31, excerpt: "Winter light, fog that burns off by eleven, and the print credit.", body: "Winter sessions are open from November to April, with four dollars of print credit per print on up to twenty prints.\n\nThe light is low and soft all day. It is quietly the best time of year." },
] as const;

const CONSENT_TERMS = "aurora-letter-2026-04";

async function seedNewsletter(tx: Tx, w: World, timeline: Timeline[]) {
  const [letter] = await tx
    .select({ id: newsletters.id })
    .from(newsletters)
    .where(eq(newsletters.slug, "aurora-coast-letter"))
    .limit(1);
  if (!letter) return { subscribers: 0, issues: 0, broadcasts: 0, recipients: 0 };

  // ~90 subscribers. Confirmed some hours after they signed up (double
  // opt-in); a handful later unsubscribed; a few never confirmed.
  const chosen = w.people.filter((_, index) => index % 5 !== 1 && index % 7 !== 3).slice(0, 92);
  const subs = chosen.map((person, index) => {
    const joinedDays = Math.max(1, Math.min(person.firstSeenDaysAgo, 175));
    const createdAt = w.daysAgo(joinedDays, 12);
    const pending = index % 23 === 7;
    const confirmedAt = pending ? null : past(w, new Date(createdAt.getTime() + w.r.int(1, 20) * HOUR));
    const unsubscribed = !pending && index % 13 === 4 && joinedDays > 40;
    const unsubscribedAt = unsubscribed ? w.daysAgo(Math.floor(joinedDays / 3), 21) : null;
    return { person, createdAt, confirmedAt, unsubscribedAt, status: pending ? "pending" : unsubscribed ? "unsubscribed" : "confirmed" };
  });
  const subRows = await tx
    .insert(newsletterSubscriptions)
    .values(
      subs.map((sub) => ({
        newsletterId: letter.id,
        contactId: w.contactIds.get(sub.person.key)!,
        status: sub.status as "pending" | "confirmed" | "unsubscribed",
        confirmToken: hex(w, 64),
        unsubscribeToken: hex(w, 64),
        confirmedAt: sub.confirmedAt,
        unsubscribedAt: sub.unsubscribedAt,
        consentTermsVersion: CONSENT_TERMS,
        consentSourceUrl: "/newsletters",
        consentEvidence: { statement: "Send me the Aurora Coast Letter. I can unsubscribe from any issue." },
        createdAt: sub.createdAt,
        updatedAt: sub.unsubscribedAt ?? sub.confirmedAt ?? sub.createdAt,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: newsletterSubscriptions.id, contactId: newsletterSubscriptions.contactId });
  const subscriptionByContact = new Map(subRows.map((row) => [row.contactId, row.id]));
  const live = subs.filter((sub) => subscriptionByContact.has(w.contactIds.get(sub.person.key)!));

  const consent: Array<typeof consentRecords.$inferInsert> = [];
  for (const sub of live) {
    const contactId = w.contactIds.get(sub.person.key)!;
    if (sub.confirmedAt) {
      consent.push({
        contactId,
        purpose: "marketing",
        channel: "email",
        state: "granted",
        method: "double_opt_in",
        termsVersion: CONSENT_TERMS,
        sourceUrl: "/newsletters",
        evidence: { statement: "Send me the Aurora Coast Letter. I can unsubscribe from any issue." },
        actor: "system",
        occurredAt: sub.confirmedAt,
        createdAt: sub.confirmedAt,
      });
      timeline.push({ contactId, actor: "system", eventType: "contact.consentChanged", subjectType: "consent", payload: { purpose: "marketing", channel: "email", state: "granted" }, occurredAt: sub.confirmedAt });
    }
    if (sub.unsubscribedAt) {
      consent.push({
        contactId,
        purpose: "marketing",
        channel: "email",
        state: "withdrawn",
        method: "preference_center",
        evidence: {},
        actor: "system",
        occurredAt: sub.unsubscribedAt,
        createdAt: sub.unsubscribedAt,
      });
      timeline.push({ contactId, actor: "system", eventType: "contact.consentChanged", subjectType: "consent", payload: { purpose: "marketing", channel: "email", state: "withdrawn" }, occurredAt: sub.unsubscribedAt });
    }
  }
  if (consent.length) {
    const inserted = await tx.insert(consentRecords).values(consent).returning({ id: consentRecords.id, contactId: consentRecords.contactId, occurredAt: consentRecords.occurredAt });
    // Point each consent timeline row at its evidence, as recordConsent does.
    const byKey = new Map(inserted.map((row) => [`${row.contactId}:${row.occurredAt.getTime()}`, row.id]));
    for (const event of timeline) {
      if (event.eventType === "contact.consentChanged" && !event.subjectId) {
        event.subjectId = byKey.get(`${event.contactId}:${(event.occurredAt as Date).getTime()}`) ?? null;
      }
    }
  }

  // The sent issues, each with its archive page.
  const actor = staffActor(w);
  const issueRows = await tx
    .insert(newsletterIssues)
    .values(
      ISSUES.map((issue) => {
        const at = w.daysAgo(issue.daysAgo, 8);
        return {
          newsletterId: letter.id,
          slug: issue.slug,
          title: issue.title,
          excerpt: issue.excerpt,
          body: issue.body,
          status: "published" as const,
          workingTitle: issue.title,
          workingExcerpt: issue.excerpt,
          workingBody: issue.body,
          version: 2,
          publishedAt: at,
          createdAt: new Date(at.getTime() - DAY),
          updatedAt: at,
        };
      }),
    )
    .onConflictDoNothing()
    .returning({ id: newsletterIssues.id, slug: newsletterIssues.slug, title: newsletterIssues.title, excerpt: newsletterIssues.excerpt, publishedAt: newsletterIssues.publishedAt });
  for (const issue of issueRows) {
    await insertPublishedPage(tx, {
      slug: `newsletters/${issue.slug}`,
      title: issue.title,
      blocks: parseBlockTree(
        [
          { id: "issue-h1", type: "heading", props: { text: issue.title, level: 1, align: "start" } },
          { id: "issue-body", type: "newsletterIssue", props: { issueId: issue.id, slug: issue.slug } },
          { id: "issue-subscribe", type: "newsletterSubscribe", props: {} },
        ],
        "page",
      ),
      seo: { description: issue.excerpt ?? `The Aurora Coast Letter: ${issue.title}` },
      at: issue.publishedAt!,
      actor,
    });
  }

  // Each issue went out as a broadcast to whoever was a confirmed subscriber
  // that morning — never to somebody pending, and never after an unsubscribe.
  const [template] = await tx
    .select({ id: emailTemplates.id })
    .from(emailTemplates)
    .where(eq(emailTemplates.kind, "campaign"))
    .limit(1);
  let broadcastCount = 0;
  let recipientCount = 0;
  if (template && issueRows.length) {
    const capturedAt = w.daysAgo(175, 8);
    const [segment] = await tx
      .insert(segments)
      .values({
        name: "Letter subscribers",
        slug: "letter-subscribers",
        description: "Everyone who confirmed the Aurora Coast Letter, captured for the archive sends.",
        kind: "static",
        definition: { match: "all", rules: [] },
        memberCountCached: live.filter((s) => s.status === "confirmed").length,
        lastEvaluatedAt: w.daysAgo(31, 8),
        capturedAt,
        createdBy: w.ownerUserId ?? w.staffUserId,
        createdAt: capturedAt,
        updatedAt: w.daysAgo(31, 8),
      })
      .onConflictDoNothing()
      .returning({ id: segments.id });
    if (segment) {
      await tx.insert(segmentMembers).values(
        live
          .filter((s) => s.status === "confirmed")
          .map((s) => ({ segmentId: segment.id, contactId: w.contactIds.get(s.person.key)!, capturedAt: w.daysAgo(31, 8) })),
      );
      for (const issue of issueRows) {
        const sentAt = issue.publishedAt!;
        const audience = live.filter(
          (s) => s.confirmedAt && s.confirmedAt < sentAt && (!s.unsubscribedAt || s.unsubscribedAt > sentAt),
        );
        if (!audience.length) continue;
        const finishedAt = past(w, new Date(sentAt.getTime() + 20 * 60_000));
        const [broadcast] = await tx
          .insert(broadcasts)
          .values({
            name: issue.title,
            templateId: template.id,
            segmentId: segment.id,
            subject: `The Aurora Coast Letter — ${issue.title}`,
            status: "sent",
            startedAt: sentAt,
            finishedAt,
            audienceCount: audience.length,
            createdByUserId: w.ownerUserId ?? w.staffUserId,
            createdAt: new Date(sentAt.getTime() - DAY),
            updatedAt: finishedAt,
          })
          .returning({ id: broadcasts.id });
        await tx.insert(broadcastRecipients).values(
          audience.map((s, n) => {
            const bounced = (n * 31 + broadcastCount) % 47 === 0;
            return {
              broadcastId: broadcast!.id,
              contactId: w.contactIds.get(s.person.key)!,
              email: s.person.email,
              state: bounced ? ("bounced" as const) : ("sent" as const),
              detail: bounced ? "Mailbox full (sample)" : null,
              sentAt: past(w, new Date(sentAt.getTime() + (n % 20) * 60_000)),
              createdAt: sentAt,
            };
          }),
        );
        broadcastCount += 1;
        recipientCount += audience.length;
      }
    }
  }
  return { subscribers: subRows.length, issues: issueRows.length, broadcasts: broadcastCount, recipients: recipientCount };
}

/* ----------------------------------------------------------- form enquiries */

const OCCASIONS = ["A wedding", "A portrait session", "Something else"] as const;
const ENQUIRIES: Record<(typeof OCCASIONS)[number], string[]> = {
  "A wedding": [
    "We are getting married at a small venue near Cumberland and would love to know if you are free.",
    "Forty guests, an outdoor ceremony if the weather allows. Is a half day possible?",
    "We loved the boatyard wedding on your journal. Could we talk about a similar day?",
  ],
  "A portrait session": [
    "Family of four plus a very excitable dog. Beach session if possible.",
    "I need new headshots for work and would rather they did not look like headshots.",
    "My parents' fortieth anniversary — a gift session for them.",
  ],
  "Something else": [
    "Do you license prints for a restaurant wall? We have three large spaces.",
    "Could you photograph our small arts collective's opening night?",
    "Is the Strait in Fog print available larger than the shop lists?",
  ],
};
const WHEN = ["Next September", "This spring", "A Saturday in June", "Flexible", "Before Christmas", "August 2027"];

async function seedEnquiries(tx: Tx, w: World, timeline: Timeline[]) {
  const [form] = await tx.select({ id: forms.id, slug: forms.slug, name: forms.name }).from(forms).where(eq(forms.slug, "contact")).limit(1);
  if (!form) return 0;
  const askers = w.people.filter((p) => p.source === "contact").slice(0, 40);
  const filler = w.people.filter((p) => p.source !== "contact");
  while (askers.length < 40 && filler.length) askers.push(filler.shift()!);
  const rows = askers.map((person) => {
    const occasion = person.tags.includes("wedding-2027") ? OCCASIONS[0] : w.r.pick(OCCASIONS);
    const at = new Date(w.daysAgo(Math.min(person.firstSeenDaysAgo, 178)).getTime() + w.r.int(0, 10) * HOUR);
    return {
      formId: form.id,
      contactId: w.contactIds.get(person.key)!,
      data: {
        name: person.name,
        email: person.email,
        occasion,
        when: w.r.pick(WHEN),
        message: w.r.pick(ENQUIRIES[occasion]),
      },
      sourceUrl: "/contact",
      status: "received" as const,
      spamReasons: [] as string[],
      createdAt: past(w, at),
    };
  });
  // Two caught by the traps: kept for review, and never on anybody's timeline.
  const spam = [0, 1].map((n) => ({
    formId: form.id,
    contactId: null,
    data: { name: "SEO Services", email: `offers${n}@example.net`, occasion: "Something else", message: "Rank #1 on Google guaranteed!!! Click here" },
    sourceUrl: "/contact",
    status: "spam" as const,
    spamReasons: ["honeypot"],
    createdAt: w.daysAgo(5 + n * 17, 3),
  }));
  const inserted = await tx.insert(formSubmissions).values([...rows, ...spam]).returning({ id: formSubmissions.id, contactId: formSubmissions.contactId, createdAt: formSubmissions.createdAt });
  for (const row of inserted) {
    if (!row.contactId) continue;
    timeline.push({
      contactId: row.contactId,
      actor: "anonymous",
      eventType: "form.submitted",
      subjectType: "form_submission",
      subjectId: row.id,
      payload: { form: form.slug, name: form.name },
      occurredAt: row.createdAt,
    });
  }
  return inserted.length;
}

/* ------------------------------------------------------------------- popup */

async function seedPopup(tx: Tx, w: World, timeline: Timeline[]) {
  const [letter] = await tx.select({ id: newsletters.id }).from(newsletters).where(eq(newsletters.slug, "aurora-coast-letter")).limit(1);
  if (!letter) return 0;
  const startedAt = w.daysAgo(60, 9);
  const [popup] = await tx
    .insert(popups)
    .values({
      slug: "letter-invite",
      name: "Letter invitation",
      title: "Get the Aurora Coast Letter",
      surface: "corner",
      trigger: "scroll",
      triggerValue: 50,
      blocks: parseBlockTree(
        [{ id: "popup-text", type: "text", props: { body: "A short note a few times a year: new prints, open session dates, and the best tides. Nothing else.", align: "start", measure: true } }],
        "chrome",
      ),
      pathPatterns: ["/blog/**", "/services/*"],
      frequencyCap: 2,
      captureMode: "email",
      newsletterId: letter.id,
      consentStatement: "Send me the Aurora Coast Letter. I can unsubscribe from any issue.",
      consentVersion: CONSENT_TERMS,
      successMessage: "Thank you — check your inbox to confirm.",
      status: "active",
      priority: 10,
      createdAt: startedAt,
      updatedAt: startedAt,
    })
    .onConflictDoNothing()
    .returning({ id: popups.id });
  if (!popup) return 0;
  const events: Array<typeof popupEvents.$inferInsert> = [];
  const paths = ["/blog/reading-the-tide-table", "/blog/what-to-wear-for-coastal-portraits", "/services/portraits", "/services/weddings", "/blog/winter-light-on-the-strait"];
  for (let n = 0; n < 420; n += 1) {
    const at = new Date(startedAt.getTime() + w.r.next() * (w.now.getTime() - startedAt.getTime()));
    const visitorKey = hex(w, 32);
    const path = w.r.pick(paths);
    events.push({ popupId: popup.id, visitorKey, kind: "shown", path, occurredAt: at });
    if (n % 4 === 0) events.push({ popupId: popup.id, visitorKey, kind: "dismissed", path, occurredAt: new Date(at.getTime() + 8_000) });
  }
  // Captures are the subscribers who joined while the popup was live.
  const capturers = w.people.filter((p) => p.firstSeenDaysAgo < 58).slice(0, 18);
  for (const person of capturers) {
    const contactId = w.contactIds.get(person.key)!;
    const at = w.daysAgo(person.firstSeenDaysAgo, 12);
    const visitorKey = hex(w, 32);
    events.push({ popupId: popup.id, visitorKey, kind: "shown", path: "/blog/reading-the-tide-table", occurredAt: new Date(at.getTime() - 30_000) });
    events.push({ popupId: popup.id, visitorKey, contactId, kind: "captured", path: "/blog/reading-the-tide-table", occurredAt: at });
    timeline.push({ contactId, actor: "anonymous", eventType: "popup.captured", subjectType: "popup", subjectId: popup.id, payload: { slug: "letter-invite" }, occurredAt: at });
  }
  for (const event of events) event.occurredAt = past(w, event.occurredAt as Date);
  await tx.insert(popupEvents).values(events);
  return events.length;
}

/* ------------------------------------------------------------------- entry */

export const seedContent: AreaSeeder = async (tx, w) => {
  const timeline: Timeline[] = [];
  const posts = await seedJournal(tx, w);
  const gallery = await seedGalleries(tx, w, timeline);
  const reviewCount = await seedReviews(tx, w, timeline);
  const letter = await seedNewsletter(tx, w, timeline);
  const enquiries = await seedEnquiries(tx, w, timeline);
  const popupEventCount = await seedPopup(tx, w, timeline);
  // Nothing on a timeline is allowed to have happened after the seed's clock.
  for (const event of timeline) event.occurredAt = past(w, event.occurredAt as Date);
  for (let i = 0; i < timeline.length; i += 500) {
    await tx.insert(timelineEvents).values(timeline.slice(i, i + 500));
  }
  return {
    posts,
    galleries: gallery.galleries,
    gallerySelections: gallery.selections,
    reviews: reviewCount,
    subscribers: letter.subscribers,
    issues: letter.issues,
    broadcasts: letter.broadcasts,
    broadcastRecipients: letter.recipients,
    formSubmissions: enquiries,
    popupEvents: popupEventCount,
    timelineEvents: timeline.length,
  };
};

// Exported for the busy-seed tests' invariant checks.
export const CONTENT_FIXTURES = { POSTS, ISSUES, REVIEW_COPY, CONSENT_TERMS } as const;
