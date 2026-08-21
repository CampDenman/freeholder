// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// OAuth authorization-code and refresh lifecycle for transactional mail.
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
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

/**
 * A usable access token for a mail account.
 *
 * The refresh itself lives in the connections core, because a connected
 * account is not a mail account: the same row now also carries calendar
 * access (C4.11), and one refresh path is what keeps a rotated credential
 * from being written twice.
 */
export { accessTokenForAccount as oauthAccessToken } from "@/core/connections/oauth-core";


export default [beginMailOAuth, completeMailOAuth];
