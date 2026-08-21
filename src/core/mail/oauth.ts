// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// OAuth authorization-code and refresh lifecycle for transactional mail.
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { providerJson, requestWithTimeout } from "@/adapters/mail/http";
import { MailAdapterError } from "@/adapters/mail/types";
import { connectedAccounts } from "@/core/connections/schema";
import { encryptSecret, decryptSecret } from "@/core/connections/crypto";
import {
  exchangeAuthorizationCode,
  fetchProviderIdentity,
  grantCapability,
  upsertConnectedAccount,
} from "@/core/connections/oauth-core";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { mailOauthStates, mailSenders } from "@/core/mail/schema";
import { uuid } from "@/core/contract";
import {
  defineService,
  ServiceError,
  type Actor,
  type Tx,
} from "@/core/service";

type OAuthProvider = "google" | "microsoft";
type OAuthCredentials = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  tokenType: string;
};

const GOOGLE_SEND = "https://www.googleapis.com/auth/gmail.send";
const MICROSOFT_SEND = "Mail.Send";
const RETURN_TO = /^\/admin(?:\/|$)/;

async function lockTransactionalDefault(tx: Tx): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${"mail-default:transactional"}))`,
  );
}

function hashState(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function callbackUrl(provider: OAuthProvider): string {
  return `${env().APP_URL.replace(/\/+$/, "")}/api/mail/oauth/${provider}/callback`;
}

function providerConfig(provider: OAuthProvider): {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  authorizeUrl: string;
  scopes: string[];
} {
  const current = env();
  if (provider === "google") {
    if (!current.GOOGLE_OAUTH_CLIENT_ID || !current.GOOGLE_OAUTH_CLIENT_SECRET) {
      throw new ServiceError(
        "validation",
        "Google mail connect needs GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.",
      );
    }
    return {
      clientId: current.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: current.GOOGLE_OAUTH_CLIENT_SECRET,
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: ["openid", "email", "profile", GOOGLE_SEND],
    };
  }
  if (
    !current.MICROSOFT_OAUTH_CLIENT_ID ||
    !current.MICROSOFT_OAUTH_CLIENT_SECRET
  ) {
    throw new ServiceError(
      "validation",
      "Microsoft mail connect needs MICROSOFT_OAUTH_CLIENT_ID and MICROSOFT_OAUTH_CLIENT_SECRET.",
    );
  }
  const tenant = encodeURIComponent(current.MICROSOFT_OAUTH_TENANT);
  return {
    clientId: current.MICROSOFT_OAUTH_CLIENT_ID,
    clientSecret: current.MICROSOFT_OAUTH_CLIENT_SECRET,
    authorizeUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    scopes: ["openid", "email", "profile", "offline_access", "User.Read", MICROSOFT_SEND],
  };
}

/** The refresh path still parses a token response of its own. */
type TokenPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
};

function requirePerson(actor: Actor): Extract<Actor, { kind: "user" }> {
  if (actor.kind !== "user") {
    throw new ServiceError(
      "permission",
      "Sign in as a person to connect a mail account.",
    );
  }
  return actor;
}

export const beginMailOAuth = defineService({
  name: "mail.beginOAuth",
  summary: "Begin a least-privilege Gmail or Microsoft mail connection.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  agentCallable: false,
  input: z.object({
    provider: z.enum(["google", "microsoft"]),
    returnTo: z.string().max(300).default("/admin/settings"),
  }),
  output: z.object({ authorizationUrl: z.string() }),
  handler: async (input, ctx) => {
    const actor = requirePerson(ctx.actor);
    if (!RETURN_TO.test(input.returnTo)) {
      throw new ServiceError("validation", "Mail connect can only return to the admin area.");
    }
    const provider = providerConfig(input.provider);
    const state = randomBytes(32).toString("base64url");
    await ctx.tx.insert(mailOauthStates).values({
      tokenHash: hashState(state),
      userId: actor.userId,
      provider: input.provider,
      returnTo: input.returnTo,
      expiresAt: sql`now() + interval '10 minutes'`,
    });
    const url = new URL(provider.authorizeUrl);
    url.searchParams.set("client_id", provider.clientId);
    url.searchParams.set("redirect_uri", callbackUrl(input.provider));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", provider.scopes.join(" "));
    url.searchParams.set("state", state);
    if (input.provider === "google") {
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("include_granted_scopes", "true");
    }
    ctx.setSubject("mail_connection", input.provider);
    return { authorizationUrl: url.toString() };
  },
});

export const completeMailOAuth = defineService({
  name: "mail.completeOAuth",
  summary: "Finish a signed-in person's Gmail or Microsoft mail connection.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  agentCallable: false,
  input: z.object({
    provider: z.enum(["google", "microsoft"]),
    state: z.string().min(30).max(200),
    code: z.string().min(1).max(4000),
  }),
  output: z.object({
    senderId: uuid,
    email: z.string(),
    returnTo: z.string(),
  }),
  handler: async (input, ctx) => {
    const actor = requirePerson(ctx.actor);
    // Claim atomically. A select followed by an update allows two callbacks
    // to observe the same unconsumed state before either update takes effect.
    // Commit the one-time claim independently before exchanging the provider
    // code. Provider codes are one-use too: if the network response is lost
    // after the provider consumes it, rolling this claim back would advertise
    // a retry that can never succeed and would weaken replay evidence.
    //
    // This is the codebase's ONE sanctioned exception to "one transaction per
    // mutation" (CLAUDE.md; MASTER.md §2 principle 12) — recorded there, not
    // just here. Caveat it carries: this handler holds its own pooled
    // connection while `db()` takes a second one, so under total pool
    // exhaustion the two acquisitions can deadlock. Keep the pool floor
    // above the worst-case concurrent OAuth completions, and do not copy
    // this shape anywhere else.
    const [state] = await db()
      .update(mailOauthStates)
      .set({ consumedAt: sql`now()` })
      .where(
        and(
          eq(mailOauthStates.tokenHash, hashState(input.state)),
          eq(mailOauthStates.userId, actor.userId),
          eq(mailOauthStates.provider, input.provider),
          // Since C4.11 the table serves calendars too, so purpose is part of
          // the match: a code issued for a calendar must not be redeemable
          // here, where it would be recorded as consent to send mail.
          eq(mailOauthStates.purpose, "mail"),
          isNull(mailOauthStates.consumedAt),
          gt(mailOauthStates.expiresAt, sql`now()`),
        ),
      )
      .returning();
    if (!state) {
      throw new ServiceError(
        "permission",
        "That mail connection has expired or does not belong to this session. Start again.",
      );
    }
    const provider = input.provider;
    const required = provider === "google" ? GOOGLE_SEND : MICROSOFT_SEND;
    const exchanged = await exchangeAuthorizationCode({
      provider,
      code: input.code,
      redirectUri: callbackUrl(input.provider),
      requiredScope: required,
      requiredScopeMessage:
        "Mail-send permission was not granted. Reconnect and approve sending mail.",
    });
    const identity = await fetchProviderIdentity(
      provider,
      exchanged.credentials.accessToken,
    );
    // Shared with the calendar flow since C4.11, which is also what makes
    // this incremental: an account already connected for calendars keeps that
    // access when it is connected for sending, and the other way round.
    const stored = await upsertConnectedAccount(ctx, {
      userId: actor.userId,
      provider,
      identity,
      credentials: exchanged.credentials,
      scopes: exchanged.scopes,
    });
    const accountId = stored.accountId;
    await grantCapability(ctx, accountId, "mail_send", required);

    await lockTransactionalDefault(ctx.tx);
    // A sender is an address. A provider that authenticated somebody without
    // telling us which mailbox is not something to guess at.
    if (!identity.email) {
      throw new ServiceError(
        "validation",
        "The provider did not return an email address for that account. Reconnect and allow access to your profile.",
      );
    }
    const senderEmail = identity.email;
    const [defaultSender] = await ctx.tx
      .select({ id: mailSenders.id })
      .from(mailSenders)
      .where(and(eq(mailSenders.purpose, "transactional"), eq(mailSenders.isDefault, true)))
      .limit(1);
    const mailProvider = provider === "google" ? "gmail" : "outlook";
    const [sender] = await ctx.tx
      .insert(mailSenders)
      .values({
        purpose: "transactional",
        provider: mailProvider,
        connectedAccountId: accountId,
        email: senderEmail,
        displayName: identity.name,
        verificationStatus: "verified",
        status: "active",
        isDefault: !defaultSender,
        lastVerifiedAt: new Date(),
        createdBy: actor.userId,
      })
      .onConflictDoUpdate({
        target: [mailSenders.purpose, mailSenders.provider, mailSenders.email],
        set: {
          connectedAccountId: accountId,
          displayName: identity.name,
          verificationStatus: "verified",
          status: "active",
          lastVerifiedAt: new Date(),
          lastError: null,
        },
      })
      .returning({ id: mailSenders.id });
    ctx.setSubject("mail_sender", sender!.id);
    ctx.queueEvent("mail.senderConnected", {
      id: sender!.id,
      provider: mailProvider,
      email: senderEmail,
    });
    return { senderId: sender!.id, email: senderEmail, returnTo: state.returnTo };
  },
});

export async function oauthAccessToken(
  tx: Tx,
  account: { id: string; provider: "google" | "microsoft" },
): Promise<string> {
  const [row] = await tx
    .select({ credentials: connectedAccounts.credentials })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.id, account.id))
    .limit(1);
  if (!row?.credentials) throw new Error("That mail connection has no credentials.");
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
    await persistRefreshFailure(account.id, row.credentials, {
      status: "needs_reconnect",
      lastError: "The provider did not issue a refresh token. Reconnect this account.",
    });
    throw new Error("That mail account needs to be reconnected.");
  }
  const provider = providerConfig(account.provider);
  const body = new URLSearchParams({
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    refresh_token: current.refreshToken,
    grant_type: "refresh_token",
    ...(account.provider === "microsoft"
      ? { scope: provider.scopes.join(" ") }
      : {}),
  });
  let token: TokenPayload;
  try {
    const response = await requestWithTimeout(globalThis.fetch, provider.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    token = await providerJson<TokenPayload>(response, account.provider);
  } catch (error) {
    const revoked =
      error instanceof MailAdapterError &&
      error.providerCode?.toLowerCase() === "invalid_grant";
    await persistRefreshFailure(
      account.id,
      row.credentials,
      revoked
        ? {
            status: "needs_reconnect",
            lastError:
              "The provider revoked or expired this mail authorization. Reconnect this account.",
          }
        : {
            lastError:
              "The mail authorization could not be refreshed. Freeholder will retry without disabling the connection.",
          },
    );
    throw error;
  }
  if (!token.access_token) throw new Error("The provider returned no refreshed access token.");
  const next: OAuthCredentials = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? current.refreshToken,
    expiresAt: new Date(Date.now() + (token.expires_in ?? 3600) * 1000).toISOString(),
    tokenType: token.token_type ?? current.tokenType ?? "Bearer",
  };
  await persistRefreshSuccess(account.id, row.credentials, next);
  return next.accessToken;
}

/**
 * Providers may rotate the refresh token as part of a successful exchange.
 * That effect cannot be rolled back with the caller's business transaction,
 * so the replacement credential must outlive that transaction as well. The
 * old encrypted value prevents a slower concurrent refresh from overwriting a
 * newer credential.
 */
async function persistRefreshSuccess(
  accountId: string,
  encryptedCredentials: string,
  credentials: OAuthCredentials,
): Promise<void> {
  await db()
    .update(connectedAccounts)
    .set({
      credentials: encryptSecret(JSON.stringify(credentials), accountId),
      status: "active",
      lastError: null,
    })
    .where(
      and(
        eq(connectedAccounts.id, accountId),
        eq(connectedAccounts.credentials, encryptedCredentials),
      ),
    );
}

/**
 * Refresh failures have to outlive the transaction that attempted the send.
 * The send deliberately throws, so writing through that transaction would
 * roll the reconnect evidence back with it. This narrowly scoped independent
 * update touches only the account whose encrypted credential value we read;
 * a concurrent successful refresh changes that value and prevents a stale
 * failure from overwriting the recovered account.
 */
async function persistRefreshFailure(
  accountId: string,
  encryptedCredentials: string,
  failure: { status?: "needs_reconnect"; lastError: string },
): Promise<void> {
  try {
    await db()
      .update(connectedAccounts)
      .set(failure)
      .where(
        and(
          eq(connectedAccounts.id, accountId),
          eq(connectedAccounts.credentials, encryptedCredentials),
        ),
      );
  } catch {
    // Preserve the provider error as the send failure. Database/doctor
    // telemetry will expose a separate persistence outage without leaking
    // credential or provider response detail into logs.
    console.error("Mail OAuth refresh evidence could not be persisted.");
  }
}

export default [beginMailOAuth, completeMailOAuth];
