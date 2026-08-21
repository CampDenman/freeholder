// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Mail as data about people (C4.18, MASTER.md §41).
//
// §41 is exact about what this is for: "the value is that the enquiry from
// three months ago is on the same timeline as the invoice." So a message
// becomes two things and no more — a correspondent resolved into the spine,
// and a timeline event against them.
//
// Three rules do the load-bearing work here.
//
// **Import is a merge, not an insert.** Every correspondent goes through
// `contacts.resolve`, the one automated door (§2 principle 3), because an
// import that creates six copies of a customer is how an address book stops
// being trusted. New arrivals then go to the duplicate queue (§30) rather than
// being silently merged on a guess.
//
// **The header is somebody else's writing.** A display name is a string a
// stranger chose; it fills a blank on a contact nobody has named, and it never
// overwrites what the owner typed — which is `contacts.resolve`'s existing
// enrich-blanks-only behaviour, relied on rather than reimplemented.
//
// **A personal mailbox is not the business's inbox.** Subjects are stored only
// for an account explicitly shared with the business. Somebody who connected
// their own mail so the CRM knows who they talk to has not handed over what
// they talked about.
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { timelineEvents } from "@/core/contacts/schema";
import {
  connectedAccounts,
  connectionCapabilities,
} from "@/core/connections/schema";
import { accessTokenForAccount } from "@/core/connections/oauth-core";
import { mailReadClient, type MailHeader } from "@/core/connections/mail-providers";
import { MailAdapterError } from "@/adapters/mail/types";
import {
  defineService,
  getService,
  hasModuleAccess,
  ServiceError,
  type Actor,
  type ServiceContext,
  type Tx,
} from "@/core/service";

/**
 * How far back a first sync reaches.
 *
 * Ninety days, because the point is the enquiry from three months ago, and a
 * decade of archive would be a slow first run and a great deal of somebody's
 * history imported on one click.
 */
const FIRST_SYNC_DAYS = 90;
const PER_RUN = 100;

export interface MailImportOutcome {
  accountId: string;
  messages: number;
  contactsCreated: number;
  timelineEvents: number;
}

async function readableAccount(
  tx: Tx,
  actor: Actor,
  id: string,
): Promise<{
  id: string;
  provider: "google" | "microsoft";
  email: string | null;
  sharedWithBusiness: boolean;
  lastSyncAt: Date | null;
}> {
  const [account] = await tx
    .select({
      id: connectedAccounts.id,
      userId: connectedAccounts.userId,
      provider: connectedAccounts.provider,
      email: connectedAccounts.email,
      sharedWithBusiness: connectedAccounts.sharedWithBusiness,
      lastSyncAt: connectedAccounts.lastSyncAt,
    })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.id, id))
    .limit(1);
  if (!account) throw new ServiceError("not_found", "No such connected account.");

  // §41: "Reading a connected account on behalf of anyone but its holder" is
  // deliberately not v1. A manage grant lets somebody administer connections;
  // it does not let them read another person's mail.
  const isHolder = actor.kind === "user" && actor.userId === account.userId;
  if (!isHolder && actor.kind !== "system") {
    if (hasModuleAccess(actor, "connections", "manage")) {
      throw new ServiceError(
        "permission",
        "A mailbox is read by the person who connected it. Managing connections is not the same as reading their mail.",
      );
    }
    throw new ServiceError("not_found", "No such connected account.");
  }
  if (account.provider !== "google" && account.provider !== "microsoft") {
    throw new ServiceError(
      "conflict",
      "Freeholder can only read Gmail and Microsoft mailboxes.",
    );
  }
  return {
    id: account.id,
    provider: account.provider,
    email: account.email,
    sharedWithBusiness: account.sharedWithBusiness,
    lastSyncAt: account.lastSyncAt,
  };
}

async function mayReadMail(tx: Tx, accountId: string): Promise<boolean> {
  const [enabled] = await tx
    .select({ id: connectionCapabilities.id })
    .from(connectionCapabilities)
    .where(
      and(
        eq(connectionCapabilities.connectedAccountId, accountId),
        eq(connectionCapabilities.capability, "mail_read"),
        eq(connectionCapabilities.enabled, true),
      ),
    )
    .limit(1);
  return Boolean(enabled);
}

/** Everybody on the message who is not the mailbox itself. */
function correspondents(
  header: MailHeader,
  mailbox: string | null,
): { participants: { email: string; name?: string }[]; direction: "in" | "out" } {
  const own = mailbox?.toLowerCase();
  const outgoing = Boolean(own && header.from?.email === own);
  const everyone = [header.from, ...header.to].filter(
    (participant): participant is { email: string; name?: string } =>
      Boolean(participant),
  );
  const seen = new Set<string>();
  const participants = everyone.filter((participant) => {
    if (participant.email === own) return false;
    if (seen.has(participant.email)) return false;
    seen.add(participant.email);
    return true;
  });
  return { participants, direction: outgoing ? "out" : "in" };
}

/**
 * One message, against one contact.
 *
 * Idempotent on `(contact, provider message id)`, because a coarse "since"
 * window will re-read messages and a timeline that gained a duplicate entry
 * every sync would be worse than no timeline.
 */
async function recordMessage(
  ctx: ServiceContext,
  input: {
    contactId: string;
    header: MailHeader;
    direction: "in" | "out";
    accountId: string;
    withSubject: boolean;
  },
): Promise<boolean> {
  const subjectId = `mail:${input.accountId}:${input.header.externalId}`;
  const [existing] = await ctx.tx
    .select({ id: timelineEvents.id })
    .from(timelineEvents)
    .where(
      and(
        eq(timelineEvents.contactId, input.contactId),
        eq(timelineEvents.subjectType, "mail_message"),
        eq(timelineEvents.subjectId, subjectId),
      ),
    )
    .limit(1);
  if (existing) return false;

  await ctx.tx.insert(timelineEvents).values({
    contactId: input.contactId,
    actor: "system",
    eventType: input.direction === "out" ? "mail.sent" : "mail.received",
    subjectType: "mail_message",
    subjectId,
    payload: {
      // The subject is the only content that ever lands here, and only for a
      // mailbox the owner said is the business's. No body, ever: the client
      // never asked the provider for one.
      ...(input.withSubject && input.header.subject
        ? { subject: input.header.subject.slice(0, 500) }
        : {}),
      direction: input.direction,
      // Marked at the point of storage, so anything reading a timeline knows
      // this text was written by somebody outside the business (§40).
      trust: "untrusted",
    },
    occurredAt: input.header.sentAt,
  });
  return true;
}

/**
 * Read one mailbox and fold what it says into the spine.
 *
 * Never returns a message body, never creates a contact directly, and never
 * overwrites a name the owner typed.
 */
export async function importMailForAccount(
  ctx: ServiceContext,
  account: {
    id: string;
    provider: "google" | "microsoft";
    email: string | null;
    sharedWithBusiness: boolean;
    lastSyncAt: Date | null;
  },
  now: Date,
): Promise<MailImportOutcome> {
  const outcome: MailImportOutcome = {
    accountId: account.id,
    messages: 0,
    contactsCreated: 0,
    timelineEvents: 0,
  };
  const since =
    account.lastSyncAt ?? new Date(now.getTime() - FIRST_SYNC_DAYS * 86_400_000);
  const accessToken = await accessTokenForAccount(ctx.tx, account);
  const headers = await mailReadClient(account.provider).listHeaders(accessToken, {
    since,
    limit: PER_RUN,
  });

  const resolve = getService("contacts.resolve");
  for (const header of headers) {
    outcome.messages += 1;
    const { participants, direction } = correspondents(header, account.email);
    for (const participant of participants) {
      // The one automated door. `resolve` fills blanks and never overwrites,
      // so a display name a stranger chose cannot rename somebody the owner
      // has already named.
      const resolved = (await ctx.callAsSystem(resolve, {
        email: participant.email,
        ...(participant.name ? { name: participant.name } : {}),
        source: `mail:${account.provider}`,
      })) as { contact: { id: string }; created: boolean };
      if (resolved.created) outcome.contactsCreated += 1;
      const written = await recordMessage(ctx, {
        contactId: resolved.contact.id,
        header,
        direction,
        accountId: account.id,
        withSubject: account.sharedWithBusiness,
      });
      if (written) outcome.timelineEvents += 1;
    }
  }

  await ctx.tx
    .update(connectedAccounts)
    .set({ lastSyncAt: now, lastError: null })
    .where(eq(connectedAccounts.id, account.id));
  return outcome;
}

export const importMail = defineService({
  name: "connections.importMail",
  summary: "Read a connected mailbox and fold its correspondents into contacts.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  agentCallable: false,
  input: z.object({ id: z.uuid() }),
  output: z.object({
    accountId: z.uuid(),
    messages: z.number().int(),
    contactsCreated: z.number().int(),
    timelineEvents: z.number().int(),
  }),
  handler: async (input, ctx) => {
    const account = await readableAccount(ctx.tx, ctx.actor, input.id);
    if (!(await mayReadMail(ctx.tx, account.id))) {
      throw new ServiceError(
        "conflict",
        "Mail reading is switched off for that connection.",
      );
    }
    ctx.setSubject("connected_account", account.id);
    return importMailForAccount(ctx, account, new Date());
  },
});

/**
 * Every mailbox with reading switched on, swept on a schedule.
 *
 * The duplicate scan runs once at the end rather than per account: §30's queue
 * is about the address book as a whole, and a candidate found twice is one
 * candidate.
 */
export async function importDueMailboxes(): Promise<{
  imported: number;
  failed: number;
  contactsCreated: number;
}> {
  const due = await db()
    .select({ id: connectedAccounts.id })
    .from(connectedAccounts)
    .innerJoin(
      connectionCapabilities,
      eq(connectionCapabilities.connectedAccountId, connectedAccounts.id),
    )
    .where(
      and(
        eq(connectedAccounts.status, "active"),
        eq(connectionCapabilities.capability, "mail_read"),
        eq(connectionCapabilities.enabled, true),
        sql`${connectedAccounts.provider} in ('google', 'microsoft')`,
      ),
    );

  let imported = 0;
  let failed = 0;
  let contactsCreated = 0;
  for (const account of due) {
    try {
      const result = (await importMail.call({ id: account.id }, { kind: "system" }));
      imported += 1;
      contactsCreated += result.contactsCreated;
    } catch (error) {
      failed += 1;
      const reason =
        error instanceof MailAdapterError || error instanceof ServiceError
          ? error.message
          : "The provider could not be reached.";
      const [state] = await db()
        .select({
          status: connectedAccounts.status,
          lastError: connectedAccounts.lastError,
        })
        .from(connectedAccounts)
        .where(eq(connectedAccounts.id, account.id))
        .limit(1);
      // As with calendars: only a grant the refresh already gave up on is
      // escalated to the owner. A transport wobble is not a reconnect prompt.
      if (state?.status === "needs_reconnect") {
        await getService("connections.flag").call(
          {
            id: account.id,
            status: "needs_reconnect",
            reason: state.lastError ?? reason,
          },
          { kind: "system" },
        );
      }
    }
  }

  // New correspondents are exactly where near-duplicates come from: the same
  // person writing from a second address. §41 sends them to the queue rather
  // than merging on a guess.
  if (contactsCreated > 0) {
    try {
      await getService("contacts.scanDuplicates").call({}, { kind: "system" });
    } catch {
      // A scan that could not run has not lost anything; the contacts are in
      // and the next sweep will find the same candidates.
    }
  }
  return { imported, failed, contactsCreated };
}

/** Exported for the tests that pin the header-splitting rules. */
export const __testing = { correspondents };

export default [importMail];
