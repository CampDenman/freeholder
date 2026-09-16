// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Social OAuth handshake (MASTER.md §33, C9.24).
//
// Provider codes are single-use. A short service commits the one-time state
// claim before an orchestrator exchanges the code with no transaction open;
// a second short service then stores the validated provider response.
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { uuid } from "@/core/contract";
import { env } from "@/core/env";
import { encryptSecret } from "@/core/connections/crypto";
import { socialAdapters } from "@/adapters/social";
import {
  defineOrchestratedService,
  defineService,
  ServiceError,
  type Actor,
} from "@/core/service";
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

const socialOAuthCompletionInput = z.object({
  provider: z.string().trim().min(1).max(80),
  state: z.string().min(30).max(200),
  code: z.string().min(1).max(4000),
});

const socialOAuthCompletionOutput = z.object({
  id: uuid,
  provider: z.string(),
  displayName: z.string(),
  status: z.literal("pending_review"),
  returnTo: z.string(),
});

const socialCredentials = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().nullable(),
  expiresAt: z.string().nullable(),
  tokenType: z.string().min(1),
  scopes: z.array(z.string()),
});

const socialIdentity = z.object({
  providerAccountId: z.string().min(1),
  displayName: z.string().min(1),
  handle: z.string().nullable(),
});

const socialCapabilities = z.object({
  read: z.boolean(),
  respond: z.boolean(),
  publish: z.boolean(),
  extras: z.array(z.string()),
});

export const claimSocialOAuthCompletion = defineService({
  name: "social.claimOAuthCompletion",
  summary: "Atomically consume one social OAuth state before its provider code is spent.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  agentCallable: false,
  external: false,
  writeClass: "write",
  input: z.object({
    provider: z.string().trim().min(1).max(80),
    stateToken: z.string().min(30).max(200),
  }),
  output: z.object({
    returnTo: z.string(),
    codeVerifier: z.string().nullable(),
  }),
  handler: async (input, ctx) => {
    const actor = requirePerson(ctx.actor);
    const [state] = await ctx.tx
      .update(socialOauthStates)
      .set({ consumedAt: sql`now()` })
      .where(
        and(
          eq(socialOauthStates.tokenHash, hashState(input.stateToken)),
          eq(socialOauthStates.userId, actor.userId),
          eq(socialOauthStates.provider, input.provider),
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
    ctx.setSubject("social_oauth_state", state.id);
    return { returnTo: state.returnTo, codeVerifier: state.codeVerifier };
  },
});

export const applySocialOAuthCompletion = defineService({
  name: "social.applyOAuthCompletion",
  summary: "Atomically store a social profile after its provider handshake completes.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  agentCallable: false,
  external: false,
  writeClass: "write",
  input: z.object({
    provider: z.string().trim().min(1).max(80),
    returnTo: z.string(),
    credentials: socialCredentials,
    identity: socialIdentity,
    capabilities: socialCapabilities,
  }),
  output: socialOAuthCompletionOutput,
  handler: async (input, ctx) => {
    const actor = requirePerson(ctx.actor);
    const adapter = adapterFor(input.provider);
    const [existing] = await ctx.tx
      .select({ id: socialProfiles.id })
      .from(socialProfiles)
      .where(
        and(
          eq(socialProfiles.provider, adapter.id),
          eq(socialProfiles.providerAccountId, input.identity.providerAccountId),
        ),
      )
      .limit(1);
    const profileId = existing?.id ?? crypto.randomUUID();
    const credentials = encryptSecret(
      JSON.stringify(input.credentials),
      profileId,
    );
    const values = {
      provider: adapter.id,
      providerAccountId: input.identity.providerAccountId,
      displayName: input.identity.displayName,
      handle: input.identity.handle,
      credentials,
      status: "pending_review" as const,
      capabilities: input.capabilities,
      tokenExpiresAt: input.credentials.expiresAt
        ? new Date(input.credentials.expiresAt)
        : null,
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
      displayName: input.identity.displayName,
      status: "pending_review" as const,
      returnTo: input.returnTo,
    };
  },
});

/** The provider exchange and identity lookup run between audited DB phases. */
export const completeOAuth = defineOrchestratedService({
  name: "social.completeOAuth",
  summary: "Finish connecting a social profile and store its credentials pending review.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  agentCallable: false,
  input: socialOAuthCompletionInput,
  output: socialOAuthCompletionOutput,
  handler: async (input, actor) => {
    const adapter = adapterFor(input.provider);
    const state = await claimSocialOAuthCompletion.call(
      { provider: adapter.id, stateToken: input.state },
      actor,
    );
    const credentials = await adapter.exchangeCode({
      code: input.code,
      redirectUri: callbackUrl(adapter.id),
      ...(state.codeVerifier ? { codeVerifier: state.codeVerifier } : {}),
    });
    const identity = await adapter.identity(credentials.accessToken);
    const discovered = adapter.capabilities(credentials.scopes);
    return applySocialOAuthCompletion.call(
      {
        provider: adapter.id,
        returnTo: state.returnTo,
        credentials,
        identity,
        capabilities: {
          read: discovered.read,
          respond: discovered.respond,
          publish: discovered.publish,
          extras: [...discovered.extras],
        },
      },
      actor,
    );
  },
});
