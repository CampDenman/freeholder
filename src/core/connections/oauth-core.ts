// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The provider handshake, shared by everything that connects an account
// (C4.11, MASTER.md §41).
//
// Mail (C1.14) built this first, for sending. Calendars need exactly the same
// handshake against exactly the same providers, so the pieces live here —
// below both — rather than being written twice. What stays with each caller
// is what genuinely differs: which scopes it asks for, where the provider
// returns to, and what it does with the account afterwards.
//
// The property this file exists to guarantee is **incremental**: an account
// already connected for mail that is then connected for calendars must end
// up holding both, not the second one. Providers support that on their side;
// this makes sure the platform does not undo it when it writes the row.
import { and, eq } from "drizzle-orm";
import { env } from "@/core/env";
import { providerJson, requestWithTimeout } from "@/adapters/mail/http";
import { MailAdapterError } from "@/adapters/mail/types";
import { db } from "@/core/db";
import { decryptSecret, encryptSecret } from "@/core/connections/crypto";
import {
  connectedAccounts,
  connectionCapabilities,
} from "@/core/connections/schema";
import { ServiceError, type ServiceContext, type Tx } from "@/core/service";

export type OAuthProvider = "google" | "microsoft";

export interface OAuthCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  tokenType: string;
}

export interface ProviderEndpoints {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
}

/** Scopes each purpose asks for. Least privilege, named where it is read. */
export const GOOGLE_SEND = "https://www.googleapis.com/auth/gmail.send";
export const MICROSOFT_SEND = "Mail.Send";
export const GOOGLE_CALENDAR_READ =
  "https://www.googleapis.com/auth/calendar.readonly";
export const GOOGLE_CALENDAR_WRITE = "https://www.googleapis.com/auth/calendar.events";
export const MICROSOFT_CALENDAR_READ = "Calendars.Read";
export const MICROSOFT_CALENDAR_WRITE = "Calendars.ReadWrite";

const IDENTITY_SCOPES = ["openid", "email", "profile"];

export function providerEndpoints(provider: OAuthProvider): ProviderEndpoints {
  const current = env();
  if (provider === "google") {
    if (!current.GOOGLE_OAUTH_CLIENT_ID || !current.GOOGLE_OAUTH_CLIENT_SECRET) {
      throw new ServiceError(
        "validation",
        "Connecting a Google account needs GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.",
      );
    }
    return {
      clientId: current.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: current.GOOGLE_OAUTH_CLIENT_SECRET,
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
    };
  }
  if (!current.MICROSOFT_OAUTH_CLIENT_ID || !current.MICROSOFT_OAUTH_CLIENT_SECRET) {
    throw new ServiceError(
      "validation",
      "Connecting a Microsoft account needs MICROSOFT_OAUTH_CLIENT_ID and MICROSOFT_OAUTH_CLIENT_SECRET.",
    );
  }
  const tenant = encodeURIComponent(current.MICROSOFT_OAUTH_TENANT);
  return {
    clientId: current.MICROSOFT_OAUTH_CLIENT_ID,
    clientSecret: current.MICROSOFT_OAUTH_CLIENT_SECRET,
    authorizeUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
  };
}

/**
 * Where the provider sends the person back. One route per purpose, so a code
 * issued for calendars cannot be redeemed by the mail flow.
 */
export function callbackUrl(path: string, provider: OAuthProvider): string {
  return `${env().APP_URL.replace(/\/+$/, "")}${path}/${provider}/callback`;
}

/**
 * The consent screen's address.
 *
 * `include_granted_scopes` is what makes Google incremental: the person is
 * asked only for what is new, and the resulting token still carries what they
 * granted before. Microsoft is incremental without being asked.
 */
export function authorizationUrl(input: {
  provider: OAuthProvider;
  redirectUri: string;
  scopes: string[];
  state: string;
  /** Microsoft needs this to issue a refresh token at all. */
  offline?: boolean;
}): string {
  const endpoints = providerEndpoints(input.provider);
  const url = new URL(endpoints.authorizeUrl);
  const scopes = [...new Set([...IDENTITY_SCOPES, ...input.scopes])];
  url.searchParams.set("client_id", endpoints.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", input.state);
  if (input.provider === "google") {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
  } else {
    url.searchParams.set("scope", [...scopes, "offline_access"].join(" "));
  }
  return url.toString();
}

type TokenPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
};

/**
 * Trade the one-time code for tokens, refusing if the person declined the
 * scope the caller actually needs. A connection that looks successful and
 * cannot do the job is worse than a refusal with a reason.
 */
export async function exchangeAuthorizationCode(input: {
  provider: OAuthProvider;
  code: string;
  redirectUri: string;
  requiredScope: string;
  requiredScopeMessage: string;
}): Promise<{ credentials: OAuthCredentials; scopes: string[] }> {
  const endpoints = providerEndpoints(input.provider);
  const body = new URLSearchParams({
    client_id: endpoints.clientId,
    client_secret: endpoints.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
  });
  const response = await requestWithTimeout(globalThis.fetch, endpoints.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const token = await providerJson<TokenPayload>(response, input.provider);
  if (!token.access_token) {
    throw new ServiceError("validation", "The provider returned no access token.");
  }
  const scopes = token.scope?.split(/\s+/).filter(Boolean) ?? [];
  if (
    input.requiredScope &&
    !scopes.some((scope) => scope.toLowerCase() === input.requiredScope.toLowerCase())
  ) {
    throw new ServiceError("permission", input.requiredScopeMessage);
  }
  return {
    scopes,
    credentials: {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + (token.expires_in ?? 3600) * 1000).toISOString(),
      tokenType: token.token_type ?? "Bearer",
    },
  };
}

/** Who the token belongs to, by the provider's own account id. */
export async function fetchProviderIdentity(
  provider: OAuthProvider,
  accessToken: string,
): Promise<{ id: string; email: string | undefined; name?: string }> {
  const url =
    provider === "google"
      ? "https://openidconnect.googleapis.com/v1/userinfo"
      : "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName";
  const response = await requestWithTimeout(globalThis.fetch, url, {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const body = await providerJson<Record<string, unknown>>(response, provider);
  const id = typeof body.sub === "string" ? body.sub : body.id;
  const email =
    typeof body.email === "string"
      ? body.email
      : typeof body.mail === "string"
        ? body.mail
        : body.userPrincipalName;
  const name =
    typeof body.name === "string"
      ? body.name
      : typeof body.displayName === "string"
        ? body.displayName
        : undefined;
  if (typeof id !== "string" || !id) {
    throw new ServiceError("validation", "The provider did not identify the account.");
  }
  return {
    id,
    // Lower-cased here rather than at each caller: an address is one identity
    // however the provider capitalises it, and the mail sender table has a
    // check constraint that says so.
    email: typeof email === "string" ? email.trim().toLowerCase() : undefined,
    name,
  };
}

/**
 * Store the account, keeping every scope it has ever been granted.
 *
 * The union is the incremental part, and it matters in both directions: a
 * person connecting calendars on the account that sends their mail must not
 * lose sending, and reconnecting mail later must not lose calendars. Several
 * accounts per provider per person work because nothing keys on the provider
 * alone — the pair (provider, provider account id) is the identity.
 */
export async function upsertConnectedAccount(
  ctx: ServiceContext,
  input: {
    userId: string;
    provider: OAuthProvider;
    identity: { id: string; email: string | undefined; name?: string };
    credentials: OAuthCredentials;
    scopes: string[];
    kind?: "personal" | "business";
  },
): Promise<{ accountId: string; scopes: string[] }> {
  const [existing] = await ctx.tx
    .select({
      id: connectedAccounts.id,
      userId: connectedAccounts.userId,
      scopesGranted: connectedAccounts.scopesGranted,
    })
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.provider, input.provider),
        eq(connectedAccounts.providerAccountId, input.identity.id),
      ),
    )
    .limit(1);

  if (existing && existing.userId !== input.userId) {
    throw new ServiceError(
      "conflict",
      "That provider account is already connected to another Freeholder profile.",
    );
  }

  const accountId = existing?.id ?? crypto.randomUUID();
  const scopes = [...new Set([...(existing?.scopesGranted ?? []), ...input.scopes])];
  const credentials = encryptSecret(JSON.stringify(input.credentials), accountId);

  if (existing) {
    await ctx.tx
      .update(connectedAccounts)
      .set({
        email: input.identity.email,
        displayName: input.identity.name,
        scopesGranted: scopes,
        credentials,
        status: "active",
        lastError: null,
      })
      .where(eq(connectedAccounts.id, accountId));
    return { accountId, scopes };
  }

  await ctx.tx.insert(connectedAccounts).values({
    id: accountId,
    userId: input.userId,
    provider: input.provider,
    providerAccountId: input.identity.id,
    email: input.identity.email,
    displayName: input.identity.name,
    kind: input.kind ?? "business",
    scopesGranted: scopes,
    credentials,
    status: "active",
  });
  return { accountId, scopes };
}

/**
 * A usable access token for this account, refreshing it if it has expired.
 *
 * Two effects here deliberately outlive the caller's transaction, because the
 * provider's side of them cannot be rolled back: a rotated refresh token must
 * be kept even if the caller's work fails, and a provider that says the grant
 * is gone must leave the account marked for reconnection rather than
 * retrying into a lockout. The compare-and-set on the old ciphertext is what
 * stops a slower concurrent refresh overwriting a newer credential.
 */
export async function accessTokenForAccount(
  tx: Tx,
  account: { id: string; provider: OAuthProvider },
): Promise<string> {
  const [row] = await tx
    .select({
      credentials: connectedAccounts.credentials,
      scopesGranted: connectedAccounts.scopesGranted,
    })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.id, account.id))
    .limit(1);
  if (!row?.credentials) {
    throw new ServiceError("conflict", "That connected account has no credentials.");
  }
  const current = JSON.parse(
    decryptSecret(row.credentials, account.id),
  ) as Partial<OAuthCredentials>;
  if (
    current.accessToken &&
    current.expiresAt &&
    new Date(current.expiresAt).getTime() > Date.now() + 60_000
  ) {
    return current.accessToken;
  }
  if (!current.refreshToken) {
    await markAccount(account.id, row.credentials, {
      status: "needs_reconnect",
      lastError: "The provider did not issue a refresh token. Reconnect this account.",
    });
    throw new ServiceError("conflict", "That account needs to be reconnected.");
  }

  const endpoints = providerEndpoints(account.provider);
  const body = new URLSearchParams({
    client_id: endpoints.clientId,
    client_secret: endpoints.clientSecret,
    refresh_token: current.refreshToken,
    grant_type: "refresh_token",
    // Microsoft wants the scopes named again, and the right answer is
    // whatever this account actually holds — including anything a later
    // purpose added to it (C4.11).
    ...(account.provider === "microsoft"
      ? { scope: [...(row.scopesGranted ?? []), "offline_access"].join(" ") }
      : {}),
  });

  let token: TokenPayload;
  try {
    const response = await requestWithTimeout(globalThis.fetch, endpoints.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    token = await providerJson<TokenPayload>(response, account.provider);
  } catch (error) {
    const revoked =
      error instanceof MailAdapterError &&
      error.providerCode?.toLowerCase() === "invalid_grant";
    await markAccount(
      account.id,
      row.credentials,
      revoked
        ? {
            status: "needs_reconnect",
            lastError:
              "The provider revoked or expired this authorization. Reconnect this account.",
          }
        : {
            lastError:
              "The authorization could not be refreshed. Freeholder will retry without disabling the connection.",
          },
    );
    throw error;
  }
  if (!token.access_token) {
    throw new ServiceError("conflict", "The provider returned no refreshed access token.");
  }
  const next: OAuthCredentials = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? current.refreshToken,
    expiresAt: new Date(Date.now() + (token.expires_in ?? 3600) * 1000).toISOString(),
    tokenType: token.token_type ?? current.tokenType ?? "Bearer",
  };
  await db()
    .update(connectedAccounts)
    .set({
      credentials: encryptSecret(JSON.stringify(next), account.id),
      status: "active",
      lastError: null,
    })
    .where(
      and(
        eq(connectedAccounts.id, account.id),
        eq(connectedAccounts.credentials, row.credentials),
      ),
    );
  return next.accessToken;
}

/**
 * Resolve or refresh a token without a caller-owned transaction remaining
 * open across the provider request. Jobs use this boundary; service handlers
 * must stage work for those jobs instead of calling it while they own a tx.
 */
export function accessTokenForAccountOutsideTransaction(
  account: { id: string; provider: OAuthProvider },
): Promise<string> {
  // The pool and transaction expose the same Drizzle query surface. Passing
  // the pool is deliberate: its SELECT releases the connection before the
  // token endpoint is contacted.
  return accessTokenForAccount(db() as unknown as Tx, account);
}

async function markAccount(
  accountId: string,
  encryptedCredentials: string,
  changes: { status?: "needs_reconnect"; lastError: string },
): Promise<void> {
  try {
    await db()
      .update(connectedAccounts)
      .set(changes)
      .where(
        and(
          eq(connectedAccounts.id, accountId),
          eq(connectedAccounts.credentials, encryptedCredentials),
        ),
      );
  } catch {
    // Preserve the provider error as the caller's failure. Database/doctor
    // telemetry will expose a separate persistence outage without leaking
    // credential or provider response detail into logs.
    console.error("OAuth refresh evidence could not be persisted.");
  }
}

/** What a connected account can be used for, as the column allows. */
export type ConnectionCapability =
  (typeof connectionCapabilities.$inferInsert)["capability"];

/** Record what this account may now be used for. */
export async function grantCapability(
  ctx: ServiceContext,
  accountId: string,
  capability: ConnectionCapability,
  scopeString: string,
): Promise<void> {
  await ctx.tx
    .insert(connectionCapabilities)
    .values({
      connectedAccountId: accountId,
      capability,
      enabled: true,
      scopeString,
      grantedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        connectionCapabilities.connectedAccountId,
        connectionCapabilities.capability,
      ],
      set: { enabled: true, scopeString, grantedAt: new Date() },
    });
}
