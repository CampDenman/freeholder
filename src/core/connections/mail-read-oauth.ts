// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Connecting a mailbox to read from (C4.18, MASTER.md §41).
//
// Its own flow rather than a flag on the sending one, for the reason C4.11
// gave calendars their own: the redirect URI is part of what a provider code
// is bound to, so a code issued to read somebody's mail cannot be redeemed as
// permission to send as them, or the other way round. Reading and sending are
// also different asks in plain language, and a consent screen that quietly
// bundled them would be the kind of thing §41 exists to prevent.
//
// Read-only, always. There is no write access here and no scope for one:
// §41's anti-roadmap says Freeholder is not becoming a mail client, and a
// token that can delete somebody's mail is not needed to learn who wrote to
// them.
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { uuid } from "@/core/contract";
import { mailOauthStates } from "@/core/mail/schema";
import {
  authorizationUrl,
  callbackUrl,
  exchangeAuthorizationCode,
  fetchProviderIdentity,
  grantCapability,
  upsertConnectedAccount,
  type OAuthProvider,
} from "@/core/connections/oauth-core";
import {
  defineOrchestratedService,
  defineService,
  ServiceError,
  type Actor,
} from "@/core/service";

const CALLBACK_PATH = "/api/connections/mail-read";
const RETURN_TO = /^\/admin(?:\/|$)/;

export const GOOGLE_MAIL_READ = "https://www.googleapis.com/auth/gmail.readonly";
export const MICROSOFT_MAIL_READ = "Mail.Read";

export function mailReadScope(provider: OAuthProvider): string {
  return provider === "google" ? GOOGLE_MAIL_READ : MICROSOFT_MAIL_READ;
}

function hashState(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requirePerson(actor: Actor): Extract<Actor, { kind: "user" }> {
  if (actor.kind !== "user") {
    throw new ServiceError(
      "permission",
      "Sign in as a person to connect a mailbox. An account belongs to somebody, not to a key.",
    );
  }
  return actor;
}

export const beginMailReadOAuth = defineService({
  name: "connections.beginMailReadOAuth",
  summary: "Start connecting a Gmail or Microsoft mailbox to read from.",
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
      throw new ServiceError(
        "validation",
        "Connecting a mailbox can only return to the admin area.",
      );
    }
    const state = randomBytes(32).toString("base64url");
    await ctx.tx.insert(mailOauthStates).values({
      tokenHash: hashState(state),
      userId: actor.userId,
      provider: input.provider,
      purpose: "mail_read",
      access: "read",
      returnTo: input.returnTo,
      expiresAt: sql`now() + interval '10 minutes'`,
    });
    ctx.setSubject("connected_account", input.provider);
    return {
      authorizationUrl: authorizationUrl({
        provider: input.provider,
        redirectUri: callbackUrl(CALLBACK_PATH, input.provider),
        scopes: [mailReadScope(input.provider)],
        state,
      }),
    };
  },
});

const mailReadOAuthCompletionInput = z.object({
  provider: z.enum(["google", "microsoft"]),
  state: z.string().min(30).max(200),
  code: z.string().min(1).max(4000),
});

const mailReadOAuthCompletionOutput = z.object({
  connectedAccountId: uuid,
  email: z.string().nullable(),
  scopes: z.array(z.string()),
  returnTo: z.string(),
});

const oauthCredentials = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
  expiresAt: z.string().datetime(),
  tokenType: z.string().min(1),
});

const providerIdentity = z.object({
  id: z.string().min(1),
  email: z.string().optional(),
  name: z.string().optional(),
});

const claimMailReadOAuthCompletion = defineService({
  name: "connections.claimMailReadOAuthCompletion",
  summary: "Atomically consume one mail-read OAuth state before its provider code is spent.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  agentCallable: false,
  external: false,
  writeClass: "write",
  input: z.object({
    provider: z.enum(["google", "microsoft"]),
    stateToken: z.string().min(30).max(200),
  }),
  output: z.object({ returnTo: z.string() }),
  handler: async (input, ctx) => {
    const actor = requirePerson(ctx.actor);
    const [state] = await ctx.tx
      .update(mailOauthStates)
      .set({ consumedAt: sql`now()` })
      .where(
        and(
          eq(mailOauthStates.tokenHash, hashState(input.stateToken)),
          eq(mailOauthStates.userId, actor.userId),
          eq(mailOauthStates.provider, input.provider),
          eq(mailOauthStates.purpose, "mail_read"),
          isNull(mailOauthStates.consumedAt),
          gt(mailOauthStates.expiresAt, sql`now()`),
        ),
      )
      .returning();
    if (!state) {
      throw new ServiceError(
        "permission",
        "That mailbox connection has expired or does not belong to this session. Start again.",
      );
    }
    ctx.setSubject("mail_oauth_state", state.tokenHash);
    return { returnTo: state.returnTo };
  },
});

const applyMailReadOAuthCompletion = defineService({
  name: "connections.applyMailReadOAuthCompletion",
  summary: "Atomically store a mail-read account after its provider handshake completes.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  agentCallable: false,
  external: false,
  writeClass: "write",
  input: z.object({
    provider: z.enum(["google", "microsoft"]),
    returnTo: z.string(),
    credentials: oauthCredentials,
    scopes: z.array(z.string()),
    identity: providerIdentity,
  }),
  output: mailReadOAuthCompletionOutput,
  handler: async (input, ctx) => {
    const actor = requirePerson(ctx.actor);
    const required = mailReadScope(input.provider);
    const stored = await upsertConnectedAccount(ctx, {
      userId: actor.userId,
      provider: input.provider,
      identity: { ...input.identity, email: input.identity.email },
      credentials: input.credentials,
      scopes: input.scopes,
    });
    await grantCapability(ctx, stored.accountId, "mail_read", required);

    ctx.setSubject("connected_account", stored.accountId);
    ctx.queueEvent("connection.mailReadConnected", {
      id: stored.accountId,
      provider: input.provider,
    });
    return {
      connectedAccountId: stored.accountId,
      email: input.identity.email ?? null,
      scopes: stored.scopes,
      returnTo: input.returnTo,
    };
  },
});

/** The provider exchange runs only between two committed, audited phases. */
export const completeMailReadOAuth = defineOrchestratedService({
  name: "connections.completeMailReadOAuth",
  summary: "Finish connecting a mailbox and store its credentials.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  agentCallable: false,
  input: mailReadOAuthCompletionInput,
  output: mailReadOAuthCompletionOutput,
  handler: async (input, actor) => {
    const state = await claimMailReadOAuthCompletion.call(
      { provider: input.provider, stateToken: input.state },
      actor,
    );
    const required = mailReadScope(input.provider);
    const exchanged = await exchangeAuthorizationCode({
      provider: input.provider,
      code: input.code,
      redirectUri: callbackUrl(CALLBACK_PATH, input.provider),
      requiredScope: required,
      requiredScopeMessage:
        "Reading mail was not granted. Reconnect and allow Freeholder to read your mail.",
    });
    const identity = await fetchProviderIdentity(
      input.provider,
      exchanged.credentials.accessToken,
    );
    return applyMailReadOAuthCompletion.call(
      {
        provider: input.provider,
        returnTo: state.returnTo,
        credentials: exchanged.credentials,
        scopes: exchanged.scopes,
        identity,
      },
      actor,
    );
  },
});

export default [
  beginMailReadOAuth,
  completeMailReadOAuth,
  claimMailReadOAuthCompletion,
  applyMailReadOAuthCompletion,
];
