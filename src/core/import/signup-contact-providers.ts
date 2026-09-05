// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Least-privilege readers for C7.16's optional signup contact import.
//
// OAuth grants access to an address book, but the request still names only the
// owner-enabled fields. Neither adapter asks for addresses, birthdays, notes,
// organisations, photos, or any other provider data Freeholder will not use.
import { and, eq } from "drizzle-orm";
import { providerJson, requestWithTimeout } from "@/adapters/mail/http";
import {
  connectedAccounts,
  connectionCapabilities,
} from "@/core/connections/schema";
import {
  accessTokenForAccountOutsideTransaction,
  type OAuthProvider,
} from "@/core/connections/oauth-core";
import { ServiceError, type Tx } from "@/core/service";
import type { SIGNUP_CONTACT_IMPORT_FIELDS } from "./contacts-schema";

export type SignupContactField = (typeof SIGNUP_CONTACT_IMPORT_FIELDS)[number];

export interface ProviderContact {
  externalId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

type GoogleField<T> = { value?: T; canonicalForm?: string; metadata?: { primary?: boolean } };
type GooglePerson = {
  resourceName?: string;
  names?: Array<GoogleField<string> & { displayName?: string }>;
  emailAddresses?: GoogleField<string>[];
  phoneNumbers?: GoogleField<string>[];
};
type GooglePage = { connections?: GooglePerson[]; nextPageToken?: string };

type MicrosoftContact = {
  id?: string;
  displayName?: string;
  emailAddresses?: Array<{ address?: string }>;
  businessPhones?: string[];
  mobilePhone?: string;
};
type MicrosoftPage = {
  value?: MicrosoftContact[];
  "@odata.nextLink"?: string;
};

function primary<T>(values: GoogleField<T>[] | undefined): GoogleField<T> | undefined {
  return values?.find((value) => value.metadata?.primary) ?? values?.[0];
}

function bounded(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean ? clean.slice(0, max) : null;
}

function googleContact(person: GooglePerson): ProviderContact | null {
  const externalId = bounded(person.resourceName, 300);
  if (!externalId) return null;
  const phone = primary(person.phoneNumbers);
  const name = person.names?.find((value) => value.metadata?.primary) ?? person.names?.[0];
  return {
    externalId,
    name: bounded(name?.displayName, 300),
    email: bounded(primary(person.emailAddresses)?.value, 320)?.toLowerCase() ?? null,
    phone: bounded(phone?.canonicalForm ?? phone?.value, 100),
  };
}

function microsoftContact(contact: MicrosoftContact): ProviderContact | null {
  const externalId = bounded(contact.id, 300);
  if (!externalId) return null;
  return {
    externalId,
    name: bounded(contact.displayName, 300),
    email: bounded(contact.emailAddresses?.[0]?.address, 320)?.toLowerCase() ?? null,
    phone: bounded(contact.mobilePhone ?? contact.businessPhones?.[0], 100),
  };
}

async function getJson<T>(url: URL | string, accessToken: string, label: string): Promise<T> {
  const response = await requestWithTimeout(globalThis.fetch, url, {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  return providerJson<T>(response, label);
}

export async function readGoogleContacts(
  accessToken: string,
  fields: readonly SignupContactField[],
  limit: number,
): Promise<ProviderContact[]> {
  const requested = [
    ...(fields.includes("name") ? ["names"] : []),
    ...(fields.includes("email") ? ["emailAddresses"] : []),
    ...(fields.includes("phone") ? ["phoneNumbers"] : []),
  ];
  const contacts: ProviderContact[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL("https://people.googleapis.com/v1/people/me/connections");
    url.searchParams.set("personFields", requested.join(","));
    url.searchParams.set("pageSize", String(Math.min(100, limit - contacts.length)));
    url.searchParams.append("sources", "READ_SOURCE_TYPE_CONTACT");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await getJson<GooglePage>(url, accessToken, "Google");
    for (const person of page.connections ?? []) {
      const parsed = googleContact(person);
      if (parsed) contacts.push(parsed);
      if (contacts.length >= limit) break;
    }
    pageToken = page.nextPageToken;
  } while (pageToken && contacts.length < limit);
  return contacts;
}

function safeMicrosoftNext(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "graph.microsoft.com" ||
    url.pathname.toLowerCase() !== "/v1.0/me/contacts"
  ) {
    throw new ServiceError("validation", "Microsoft returned an unsafe contacts page link.");
  }
  return url.toString();
}

export async function readMicrosoftContacts(
  accessToken: string,
  fields: readonly SignupContactField[],
  limit: number,
): Promise<ProviderContact[]> {
  const selected = [
    "id",
    ...(fields.includes("name") ? ["displayName"] : []),
    ...(fields.includes("email") ? ["emailAddresses"] : []),
    ...(fields.includes("phone") ? ["businessPhones", "mobilePhone"] : []),
  ];
  const first = new URL("https://graph.microsoft.com/v1.0/me/contacts");
  first.searchParams.set("$select", selected.join(","));
  first.searchParams.set("$top", String(Math.min(100, limit)));
  let next: string | undefined = first.toString();
  const contacts: ProviderContact[] = [];
  while (next && contacts.length < limit) {
    const page = await getJson<MicrosoftPage>(next, accessToken, "Microsoft");
    for (const contact of page.value ?? []) {
      const parsed = microsoftContact(contact);
      if (parsed) contacts.push(parsed);
      if (contacts.length >= limit) break;
    }
    next = safeMicrosoftNext(page["@odata.nextLink"]);
  }
  return contacts;
}

export async function providerContactSourceForUser(
  tx: Tx,
  input: {
    userId: string;
    accountId: string;
  },
): Promise<{ accountId: string; provider: OAuthProvider }> {
  const [account] = await tx
    .select({
      id: connectedAccounts.id,
      userId: connectedAccounts.userId,
      provider: connectedAccounts.provider,
      status: connectedAccounts.status,
      capability: connectionCapabilities.capability,
      enabled: connectionCapabilities.enabled,
    })
    .from(connectedAccounts)
    .innerJoin(
      connectionCapabilities,
      eq(connectionCapabilities.connectedAccountId, connectedAccounts.id),
    )
    .where(
      and(
        eq(connectedAccounts.id, input.accountId),
        eq(connectedAccounts.userId, input.userId),
        eq(connectionCapabilities.capability, "contacts_read"),
        eq(connectionCapabilities.enabled, true),
      ),
    )
    .limit(1);
  if (
    !account ||
    account.status !== "active" ||
    (account.provider !== "google" && account.provider !== "microsoft")
  ) {
    throw new ServiceError("not_found", "That contacts connection is unavailable.");
  }
  return { accountId: account.id, provider: account.provider };
}

/** Resolve credentials and page through the provider with no service tx open. */
export async function providerContactsForSource(input: {
  accountId: string;
  provider: OAuthProvider;
  fields: readonly SignupContactField[];
  limit: number;
}): Promise<{ provider: OAuthProvider; contacts: ProviderContact[] }> {
  const accessToken = await accessTokenForAccountOutsideTransaction({
    id: input.accountId,
    provider: input.provider,
  });
  const contacts =
    input.provider === "google"
      ? await readGoogleContacts(accessToken, input.fields, input.limit)
      : await readMicrosoftContacts(accessToken, input.fields, input.limit);
  return { provider: input.provider, contacts };
}
