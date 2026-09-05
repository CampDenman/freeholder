// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Connecting a calendar (C4.11, MASTER.md §41).
//
// The same handshake mail uses, asking for calendar scopes instead of send —
// which is the point of `oauth-core`: one vendor boundary, two purposes.
//
// Three properties §41 asks for, made structural here:
//
// **Incremental.** Connecting a calendar on the account that already sends
// mail adds calendar access; it does not replace sending. The scope union
// lives in `upsertConnectedAccount`, and the consent screen asks Google for
// `include_granted_scopes` so the person is only asked about what is new.
//
// **Several accounts per provider, per person.** Nothing keys on the provider
// alone. A person can connect their own calendar and the shop's, and both are
// theirs; whether an *agent* may read either is a separate grant (C4.10).
//
// **Read by default.** Write access to somebody's calendar is a different
// request from reading it, so it is a different scope and a different
// capability, chosen when the connection starts.
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
  GOOGLE_CALENDAR_READ,
  GOOGLE_CALENDAR_WRITE,
  MICROSOFT_CALENDAR_READ,
  MICROSOFT_CALENDAR_WRITE,
  type OAuthProvider,
} from "@/core/connections/oauth-core";
import {
  defineOrchestratedService,
  defineService,
  ServiceError,
  type Actor,
} from "@/core/service";

const CALLBACK_PATH = "/api/connections/calendar";
const RETURN_TO = /^\/admin(?:\/|$)/;

function hashState(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requirePerson(actor: Actor): Extract<Actor, { kind: "user" }> {
  if (actor.kind !== "user") {
    throw new ServiceError(
      "permission",
      "Sign in as a person to connect a calendar. An account belongs to somebody, not to a key.",
    );
  }
  return actor;
}

export function calendarScope(
  provider: OAuthProvider,
  access: "read" | "write",
): string {
  if (provider === "google") {
    return access === "write" ? GOOGLE_CALENDAR_WRITE : GOOGLE_CALENDAR_READ;
  }
  return access === "write" ? MICROSOFT_CALENDAR_WRITE : MICROSOFT_CALENDAR_READ;
}

export const beginCalendarOAuth = defineService({
  name: "connections.beginCalendarOAuth",
  summary: "Start connecting a Google or Microsoft calendar.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  agentCallable: false,
  input: z.object({
    provider: z.enum(["google", "microsoft"]),
    access: z.enum(["read", "write"]).default("read"),
    returnTo: z.string().max(300).default("/admin/settings"),
  }),
  output: z.object({ authorizationUrl: z.string() }),
  handler: async (input, ctx) => {
    const actor = requirePerson(ctx.actor);
    if (!RETURN_TO.test(input.returnTo)) {
      throw new ServiceError(
        "validation",
        "Connecting a calendar can only return to the admin area.",
      );
    }
    const state = randomBytes(32).toString("base64url");
    await ctx.tx.insert(mailOauthStates).values({
      tokenHash: hashState(state),
      userId: actor.userId,
      provider: input.provider,
      purpose: "calendar",
      access: input.access,
      returnTo: input.returnTo,
      expiresAt: sql`now() + interval '10 minutes'`,
    });
    ctx.setSubject("connected_account", input.provider);
    return {
      authorizationUrl: authorizationUrl({
        provider: input.provider,
        redirectUri: callbackUrl(CALLBACK_PATH, input.provider),
        scopes: [calendarScope(input.provider, input.access)],
        state,
      }),
    };
  },
});

const calendarOAuthCompletionInput = z.object({
  provider: z.enum(["google", "microsoft"]),
  state: z.string().min(30).max(200),
  code: z.string().min(1).max(4000),
});

const calendarOAuthCompletionOutput = z.object({
  connectedAccountId: uuid,
  email: z.string().nullable(),
  access: z.enum(["read", "write"]),
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

const claimCalendarOAuthCompletion = defineService({
  name: "connections.claimCalendarOAuthCompletion",
  summary: "Atomically consume one calendar OAuth state before its provider code is spent.",
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
  output: z.object({
    access: z.enum(["read", "write"]),
    returnTo: z.string(),
  }),
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
          eq(mailOauthStates.purpose, "calendar"),
          isNull(mailOauthStates.consumedAt),
          gt(mailOauthStates.expiresAt, sql`now()`),
        ),
      )
      .returning();
    if (!state) {
      throw new ServiceError(
        "permission",
        "That calendar connection has expired or does not belong to this session. Start again.",
      );
    }
    ctx.setSubject("mail_oauth_state", state.tokenHash);
    return { access: state.access, returnTo: state.returnTo };
  },
});

const applyCalendarOAuthCompletion = defineService({
  name: "connections.applyCalendarOAuthCompletion",
  summary: "Atomically store a calendar account after its provider handshake completes.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  agentCallable: false,
  external: false,
  writeClass: "write",
  input: z.object({
    provider: z.enum(["google", "microsoft"]),
    access: z.enum(["read", "write"]),
    returnTo: z.string(),
    credentials: oauthCredentials,
    scopes: z.array(z.string()),
    identity: providerIdentity,
  }),
  output: calendarOAuthCompletionOutput,
  handler: async (input, ctx) => {
    const actor = requirePerson(ctx.actor);
    const required = calendarScope(input.provider, input.access);
    const stored = await upsertConnectedAccount(ctx, {
      userId: actor.userId,
      provider: input.provider,
      identity: { ...input.identity, email: input.identity.email },
      credentials: input.credentials,
      scopes: input.scopes,
    });
    await grantCapability(ctx, stored.accountId, "calendar_read", required);
    if (input.access === "write") {
      await grantCapability(ctx, stored.accountId, "calendar_write", required);
    }

    ctx.setSubject("connected_account", stored.accountId);
    ctx.queueEvent("connection.calendarConnected", {
      id: stored.accountId,
      provider: input.provider,
      access: input.access,
    });
    return {
      connectedAccountId: stored.accountId,
      email: input.identity.email ?? null,
      access: input.access,
      scopes: stored.scopes,
      returnTo: input.returnTo,
    };
  },
});

/** The provider exchange runs only between two committed, audited phases. */
export const completeCalendarOAuth = defineOrchestratedService({
  name: "connections.completeCalendarOAuth",
  summary: "Finish connecting a calendar and store its credentials.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  agentCallable: false,
  input: calendarOAuthCompletionInput,
  output: calendarOAuthCompletionOutput,
  handler: async (input, actor) => {
    const state = await claimCalendarOAuthCompletion.call(
      { provider: input.provider, stateToken: input.state },
      actor,
    );
    const required = calendarScope(input.provider, state.access);
    const exchanged = await exchangeAuthorizationCode({
      provider: input.provider,
      code: input.code,
      redirectUri: callbackUrl(CALLBACK_PATH, input.provider),
      requiredScope: required,
      requiredScopeMessage:
        state.access === "write"
          ? "Calendar editing was not granted. Reconnect and allow changes to events."
          : "Calendar access was not granted. Reconnect and allow reading the calendar.",
    });
    const identity = await fetchProviderIdentity(
      input.provider,
      exchanged.credentials.accessToken,
    );
    return applyCalendarOAuthCompletion.call(
      {
        provider: input.provider,
        access: state.access,
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
  beginCalendarOAuth,
  completeCalendarOAuth,
  claimCalendarOAuthCompletion,
  applyCalendarOAuthCompletion,
];
