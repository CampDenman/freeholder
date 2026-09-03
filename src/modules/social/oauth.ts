// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Social OAuth handshake (MASTER.md §33, C9.24).
//
// Provider codes are single-use. The one-time state claim is committed on a
// second connection *before* the code is exchanged — the same sanctioned
// exception as `mail.completeOAuth` and `connections.completeCalendarOAuth`,
// recorded in CLAUDE.md. Rolling the claim back would advertise a retry that
// can never succeed. The caveat is the same: this must not run inside a
// request that already holds another pool connection, or the pool of one can
// deadlock.
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { uuid } from "@/core/contract";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { encryptSecret } from "@/core/connections/crypto";
import { socialAdapters } from "@/adapters/social";
import { defineService, ServiceError, type Actor } from "@/core/service";
import { socialOauthStates, socialProfiles } from "./schema";

const CALLBACK_PATH = "/api/social";
const RETURN_TO = /^\/admin(?:\/|$)/;

function hashState(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requirePerson(actor: Actor): Extract<Actor, { kind: "user" }> {
  if (actor.kind !== "user") {
    throw new ServiceError(
      "permission",
      "Sign in as a person to connect a social account.",
    );
  }
  return actor;
}

function adapterFor(provider: string) {
  try {
    const adapter = socialAdapters.get(provider);
    if (adapter.id === "none") {
      throw new ServiceError("not_found", `"${provider}" is not a social network this instance knows.`);
    }
    return adapter;
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(
      "not_found",
      `"${provider}" is not a social network this instance knows.`,
    );
  }
}

function callbackUrl(provider: string): string {
  return `${env().APP_URL.replace(/\/+$/, "")}${CALLBACK_PATH}/${provider}/callback`;
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export const beginOAuth = defineService({
  name: "social.beginOAuth",
  summary: "Start connecting a social profile through its provider.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  agentCallable: false,
  input: z.object({
    provider: z.string().trim().min(1).max(80),
    returnTo: z.string().max(300).default("/admin/social"),
  }),
  output: z.object({ authorizationUrl: z.string() }),
  handler: async (input, ctx) => {
    const actor = requirePerson(ctx.actor);
    if (!RETURN_TO.test(input.returnTo)) {
      throw new ServiceError(
        "validation",
        "Connecting a social profile can only return to the admin area.",
      );
    }
    const adapter = adapterFor(input.provider);
    if (!adapter.status.available) {
      throw new ServiceError("validation", adapter.status.message);
    }
    const state = randomBytes(32).toString("base64url");
    const verifier = adapter.pkce ? randomBytes(32).toString("base64url") : null;
    await ctx.tx.insert(socialOauthStates).values({
      tokenHash: hashState(state),
      userId: actor.userId,
      provider: adapter.id,
      returnTo: input.returnTo,
      codeVerifier: verifier,
      expiresAt: sql`now() + interval '10 minutes'`,
    });
    ctx.setSubject("social_profile", adapter.id);
    return {
      authorizationUrl: adapter.authorizationUrl({
        redirectUri: callbackUrl(adapter.id),
        state,
        ...(verifier ? { codeChallenge: pkceChallenge(verifier) } : {}),
      }),
    };
  },
});

export const completeOAuth = defineService({
  name: "social.completeOAuth",
  summary: "Finish connecting a social profile and store its credentials pending review.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  agentCallable: false,
  input: z.object({
    provider: z.string().trim().min(1).max(80),
    state: z.string().min(30).max(200),
    code: z.string().min(1).max(4000),
  }),
  output: z.object({
    id: uuid,
    provider: z.string(),
    displayName: z.string(),
    status: z.literal("pending_review"),
    returnTo: z.string(),
  }),
  handler: async (input, ctx) => {
    const actor = requirePerson(ctx.actor);
    const adapter = adapterFor(input.provider);
    // Second connection: claim the one-time state before spending the
    // provider code. See the file header and CLAUDE.md.
    const [state] = await db()
      .update(socialOauthStates)
      .set({ consumedAt: sql`now()` })
      .where(
        and(
          eq(socialOauthStates.tokenHash, hashState(input.state)),
          eq(socialOauthStates.userId, actor.userId),
          eq(socialOauthStates.provider, adapter.id),
          isNull(socialOauthStates.consumedAt),
          gt(socialOauthStates.expiresAt, sql`now()`),
        ),
      )
      .returning();
    if (!state) {
      throw new ServiceError(
        "permission",
        "That social connection has expired or does not belong to this session. Start again.",
      );
    }

    const tokens = await adapter.exchangeCode({
      code: input.code,
      redirectUri: callbackUrl(adapter.id),
      ...(state.codeVerifier ? { codeVerifier: state.codeVerifier } : {}),
    });
    const identity = await adapter.identity(tokens.accessToken);
    const discovered = adapter.capabilities(tokens.scopes);
    const capabilities = {
      read: discovered.read,
      respond: discovered.respond,
      publish: discovered.publish,
      extras: [...discovered.extras],
    };

    const [existing] = await ctx.tx
      .select({ id: socialProfiles.id })
      .from(socialProfiles)
      .where(
        and(
          eq(socialProfiles.provider, adapter.id),
          eq(socialProfiles.providerAccountId, identity.providerAccountId),
        ),
      )
      .limit(1);
    const profileId = existing?.id ?? crypto.randomUUID();
    const credentials = encryptSecret(JSON.stringify(tokens), profileId);
    const values = {
      provider: adapter.id,
      providerAccountId: identity.providerAccountId,
      displayName: identity.displayName,
      handle: identity.handle,
      credentials,
      status: "pending_review" as const,
      capabilities,
      tokenExpiresAt: tokens.expiresAt ? new Date(tokens.expiresAt) : null,
      lastError: null,
      connectedBy: actor.userId,
      reviewedAt: null,
      reviewedBy: null,
    };
    if (existing) {
      await ctx.tx
        .update(socialProfiles)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(socialProfiles.id, profileId));
    } else {
      await ctx.tx.insert(socialProfiles).values({ id: profileId, ...values });
    }
    ctx.setSubject("social_profile", profileId);
    ctx.queueEvent("social.profileConnected", {
      id: profileId,
      provider: adapter.id,
    });
    return {
      id: profileId,
      provider: adapter.id,
      displayName: identity.displayName,
      status: "pending_review" as const,
      returnTo: state.returnTo,
    };
  },
});
