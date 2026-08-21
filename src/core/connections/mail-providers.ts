// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Reading who wrote to a mailbox (C4.18, MASTER.md §41).
//
// §41: "Mail is read as data about people, not as an inbox to reimplement."
// So this asks each provider for headers and nothing else — who, when, and
// what the subject line said. No bodies, no attachments, no threads. That is
// not only a privacy stance: a client that never downloads a body cannot leak
// one, and Freeholder is explicitly not becoming a mail client (§36).
import { requestWithTimeout, providerJson } from "@/adapters/mail/http";
import type { OAuthProvider } from "@/core/connections/oauth-core";

export interface MailParticipant {
  email: string;
  /**
   * The display name the sender chose, which is a string somebody else wrote
   * (§41). It is stored as a suggestion and never as the truth about a person.
   */
  name?: string;
}

export interface MailHeader {
  externalId: string;
  sentAt: Date;
  subject?: string;
  from?: MailParticipant;
  to: readonly MailParticipant[];
}

export interface MailReadClient {
  listHeaders(
    accessToken: string,
    input: { since: Date; limit: number },
  ): Promise<readonly MailHeader[]>;
}

/** Bounded per run: a first sync of a decade-old mailbox is not a stampede. */
const MAX_MESSAGES = 100;

/**
 * `Name <someone@example.com>, other@example.com` — the shape every provider
 * hands back for an address header, and the one place a malformed one is
 * allowed to be simply dropped.
 */
export function parseAddresses(value: string | undefined): MailParticipant[] {
  if (!value) return [];
  const found: MailParticipant[] = [];
  // Split on commas that are not inside quotes, because a display name is
  // routinely "Surname, Firstname".
  const parts = value.match(/(?:"[^"]*"|[^,])+/g) ?? [];
  for (const part of parts) {
    const angled = /<([^>]+)>/.exec(part);
    const address = (angled?.[1] ?? part).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(address)) continue;
    const rawName = angled ? part.slice(0, angled.index).trim() : "";
    const name = rawName.replace(/^"|"$/g, "").trim();
    found.push(name ? { email: address, name } : { email: address });
    if (found.length >= 20) break;
  }
  return found;
}

async function getJson<T>(url: string, accessToken: string, label: string): Promise<T> {
  const response = await requestWithTimeout(globalThis.fetch, url, {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  return providerJson<T>(response, label);
}

type GmailList = { messages?: { id?: string }[] };
type GmailMessage = {
  id?: string;
  internalDate?: string;
  payload?: { headers?: { name?: string; value?: string }[] };
};

function gmailHeader(message: GmailMessage, name: string): string | undefined {
  return message.payload?.headers?.find(
    (header) => header.name?.toLowerCase() === name,
  )?.value;
}

const google: MailReadClient = {
  async listHeaders(accessToken, input) {
    const list = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    list.searchParams.set("maxResults", String(Math.min(input.limit, MAX_MESSAGES)));
    // Gmail's own query language, in seconds. Coarser than the cursor a
    // calendar gets, and enough: the worst case is re-reading a message whose
    // import is idempotent anyway.
    list.searchParams.set(
      "q",
      `after:${Math.floor(input.since.getTime() / 1000)} -in:spam -in:trash`,
    );
    const listed = await getJson<GmailList>(list.toString(), accessToken, "Google");

    const headers: MailHeader[] = [];
    for (const summary of listed.messages ?? []) {
      if (!summary.id) continue;
      const url = new URL(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(summary.id)}`,
      );
      // The narrowest request the API offers: headers, never the body.
      url.searchParams.set("format", "metadata");
      for (const header of ["From", "To", "Subject", "Date"]) {
        url.searchParams.append("metadataHeaders", header);
      }
      const message = await getJson<GmailMessage>(url.toString(), accessToken, "Google");
      const sentAt = message.internalDate
        ? new Date(Number(message.internalDate))
        : new Date(gmailHeader(message, "date") ?? Date.now());
      if (Number.isNaN(sentAt.getTime())) continue;
      headers.push({
        externalId: summary.id,
        sentAt,
        subject: gmailHeader(message, "subject"),
        from: parseAddresses(gmailHeader(message, "from"))[0],
        to: parseAddresses(gmailHeader(message, "to")),
      });
    }
    return headers;
  },
};

type GraphList = {
  value?: {
    id?: string;
    subject?: string;
    receivedDateTime?: string;
    sentDateTime?: string;
    from?: { emailAddress?: { address?: string; name?: string } };
    toRecipients?: { emailAddress?: { address?: string; name?: string } }[];
  }[];
};

function graphParticipant(
  value: { address?: string; name?: string } | undefined,
): MailParticipant | undefined {
  const email = value?.address?.trim().toLowerCase();
  if (!email) return undefined;
  return value?.name ? { email, name: value.name } : { email };
}

const microsoft: MailReadClient = {
  async listHeaders(accessToken, input) {
    const url = new URL("https://graph.microsoft.com/v1.0/me/messages");
    // $select is the whole privacy control here: ask for the body and it
    // arrives, so this never asks.
    url.searchParams.set(
      "$select",
      "id,subject,receivedDateTime,sentDateTime,from,toRecipients",
    );
    url.searchParams.set("$top", String(Math.min(input.limit, MAX_MESSAGES)));
    url.searchParams.set("$orderby", "receivedDateTime desc");
    url.searchParams.set(
      "$filter",
      `receivedDateTime ge ${input.since.toISOString()}`,
    );
    const listed = await getJson<GraphList>(url.toString(), accessToken, "Microsoft");

    const headers: MailHeader[] = [];
    for (const message of listed.value ?? []) {
      if (!message.id) continue;
      const sentAt = new Date(
        message.receivedDateTime ?? message.sentDateTime ?? Date.now(),
      );
      if (Number.isNaN(sentAt.getTime())) continue;
      headers.push({
        externalId: message.id,
        sentAt,
        subject: message.subject ?? undefined,
        from: graphParticipant(message.from?.emailAddress),
        to: (message.toRecipients ?? [])
          .map((recipient) => graphParticipant(recipient.emailAddress))
          .filter((participant): participant is MailParticipant => Boolean(participant)),
      });
    }
    return headers;
  },
};

export function mailReadClient(provider: OAuthProvider): MailReadClient {
  return provider === "google" ? google : microsoft;
}
