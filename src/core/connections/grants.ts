// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Which worker may reach which connected account (C4.10, MASTER.md §41).
//
// A scope says what kind of thing an agent may do. It cannot say *whose*, and
// on an instance holding the owner's Gmail, a shared shop inbox and a staff
// member's personal calendar, whose is the entire question. So this is a
// second, narrower permission: an owner grants one agent access to one
// account, and everything else is refused by absence.
//
// The rule the rest of the platform depends on: **no code reads a connected
// account on an agent's behalf except through `accountsForAgent` or
// `assertAgentMayUseAccount`.** Calendar sync (C4.11–C4.13) and mail import
// (C4.18) are the callers this exists for; the agent-facing listing below is
// the first, so the grant is load-bearing the day it ships rather than a
// table waiting for a consumer.
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { agents } from "@/core/agents/schema";
import { agentConnectionGrants, connectedAccounts } from "@/core/connections/schema";
import {
  defineService,
  ServiceError,
  type Actor,
  type ServiceContext,
  type Tx,
} from "@/core/service";

const ACCESS = ["read", "write"] as const;

function requirePerson(actor: Actor, verb: string): string | null {
  if (actor.kind === "agent") {
    throw new ServiceError(
      "permission",
      `An API key cannot ${verb}. An agent granting itself an account is not a grant.`,
    );
  }
  return actor.kind === "user" ? actor.userId : null;
}

/** The agent behind this key, by the key join rather than a name match. */
async function agentForActor(tx: Tx, actor: Actor): Promise<{ id: string; name: string }> {
  if (actor.kind !== "agent") {
    throw new ServiceError("permission", "This is for agents.");
  }
  const { apiKeys } = await import("@/core/apikeys/schema");
  const [found] = await tx
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .innerJoin(apiKeys, eq(apiKeys.id, agents.apiKeyId))
    .where(eq(apiKeys.name, actor.keyName))
    .limit(1);
  if (!found) throw new ServiceError("not_found", "This key does not belong to an agent.");
  return found;
}

export interface GrantedAccount {
  id: string;
  provider: string;
  email: string | null;
  displayName: string | null;
  status: string;
  access: "read" | "write";
}

/**
 * Every connected account this agent may use, and how.
 *
 * Revoked grants and revoked accounts are both excluded here rather than
 * checked by the caller: a permission that each consumer has to remember to
 * re-check is one that will eventually be forgotten in one of them.
 */
export async function accountsForAgent(
  ctx: ServiceContext,
  agentId: string,
): Promise<GrantedAccount[]> {
  return ctx.tx
    .select({
      id: connectedAccounts.id,
      provider: connectedAccounts.provider,
      email: connectedAccounts.email,
      displayName: connectedAccounts.displayName,
      status: connectedAccounts.status,
      access: agentConnectionGrants.access,
    })
    .from(agentConnectionGrants)
    .innerJoin(
      connectedAccounts,
      eq(connectedAccounts.id, agentConnectionGrants.connectedAccountId),
    )
    .where(
      and(
        eq(agentConnectionGrants.agentId, agentId),
        isNull(agentConnectionGrants.revokedAt),
        inArray(connectedAccounts.status, ["active", "needs_reconnect"]),
      ),
    );
}

/**
 * The one door. Throws unless this agent holds a live grant on this account
 * at this access level — and says the same thing for "no such account" as for
 * "not granted", so an agent cannot map the instance by probing ids.
 */
export async function assertAgentMayUseAccount(
  ctx: ServiceContext,
  accountId: string,
  access: "read" | "write" = "read",
): Promise<GrantedAccount> {
  const agent = await agentForActor(ctx.tx, ctx.actor);
  const granted = await accountsForAgent(ctx, agent.id);
  const match = granted.find((account) => account.id === accountId);
  if (!match || (access === "write" && match.access !== "write")) {
    throw new ServiceError(
      "not_found",
      "No such connected account is available to this agent.",
    );
  }
  if (match.status !== "active") {
    throw new ServiceError(
      "conflict",
      "That account needs reconnecting before it can be used again.",
    );
  }
  return match;
}

const grantRow = row({
  id: uuid,
  agentId: uuid,
  agentName: z.string(),
  connectedAccountId: uuid,
  provider: z.string(),
  email: z.string().nullable(),
  access: z.enum(ACCESS),
  revokedAt: timestamp.nullable(),
  createdAt: timestamp,
});

export const listConnectionGrants = defineService({
  name: "connections.grants",
  summary: "Which workers may use which connected accounts.",
  kind: "query",
  permission: "scoped",
  agentCallable: false,
  input: z.object({ includeRevoked: z.boolean().default(false) }),
  output: listed(grantRow),
  handler: (input, ctx) =>
    ctx.tx
      .select({
        id: agentConnectionGrants.id,
        agentId: agentConnectionGrants.agentId,
        agentName: agents.name,
        connectedAccountId: agentConnectionGrants.connectedAccountId,
        provider: connectedAccounts.provider,
        email: connectedAccounts.email,
        access: agentConnectionGrants.access,
        revokedAt: agentConnectionGrants.revokedAt,
        createdAt: agentConnectionGrants.createdAt,
      })
      .from(agentConnectionGrants)
      .innerJoin(agents, eq(agents.id, agentConnectionGrants.agentId))
      .innerJoin(
        connectedAccounts,
        eq(connectedAccounts.id, agentConnectionGrants.connectedAccountId),
      )
      .where(input.includeRevoked ? undefined : isNull(agentConnectionGrants.revokedAt)),
});

export const grantAccountToAgent = defineService({
  name: "connections.grantToAgent",
  summary: "Let one worker use one connected account.",
  kind: "mutation",
  permission: "scoped",
  // Step-up and human-only for the same reason connecting the account was:
  // this is the moment somebody's mailbox becomes reachable by software.
  stepUp: true,
  agentCallable: false,
  input: z.object({
    agentId: z.uuid(),
    connectedAccountId: z.uuid(),
    access: z.enum(ACCESS).default("read"),
  }),
  output: grantRow,
  handler: async (input, ctx) => {
    const grantedBy = requirePerson(ctx.actor, "grant an account");
    const [account] = await ctx.tx
      .select({ id: connectedAccounts.id, status: connectedAccounts.status })
      .from(connectedAccounts)
      .where(eq(connectedAccounts.id, input.connectedAccountId))
      .limit(1);
    if (!account) throw new ServiceError("not_found", "No such connected account.");
    if (account.status === "revoked") {
      throw new ServiceError(
        "conflict",
        "That account has been revoked. Reconnect it before granting access.",
      );
    }
    const [agent] = await ctx.tx
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(eq(agents.id, input.agentId))
      .limit(1);
    if (!agent) throw new ServiceError("not_found", "No such agent.");

    // Re-granting a revoked grant reuses the row, so the history of who had
    // what stays one line per pair rather than a pile of duplicates.
    const [saved] = await ctx.tx
      .insert(agentConnectionGrants)
      .values({
        agentId: agent.id,
        connectedAccountId: account.id,
        access: input.access,
        grantedBy,
      })
      .onConflictDoUpdate({
        target: [
          agentConnectionGrants.agentId,
          agentConnectionGrants.connectedAccountId,
        ],
        set: {
          access: input.access,
          grantedBy,
          revokedAt: null,
          revokedReason: null,
          updatedAt: sql`now()`,
        },
      })
      .returning();

    ctx.setSubject("connected_account", account.id);
    ctx.queueEvent("connection.grantedToAgent", {
      id: account.id,
      agentId: agent.id,
      agentName: agent.name,
      access: input.access,
    });
    return ctx.call(listConnectionGrants, { includeRevoked: true }).then(
      (rows) => rows.find((row) => row.id === saved!.id)!,
    );
  },
});

export const revokeAccountFromAgent = defineService({
  name: "connections.revokeFromAgent",
  summary: "Stop one worker using one connected account.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  // Deliberately no step-up: taking access away is the safe direction, and a
  // second-factor challenge between an owner and revocation is friction in
  // exactly the wrong place (the same call C4.07 made for the kill switch).
  input: z.object({
    agentId: z.uuid(),
    connectedAccountId: z.uuid(),
    reason: z.string().trim().max(500).optional(),
  }),
  output: z.object({ revoked: z.number().int() }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor, "revoke an account");
    const revoked = await ctx.tx
      .update(agentConnectionGrants)
      .set({
        revokedAt: sql`now()`,
        revokedReason: input.reason ?? "Revoked by the owner.",
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(agentConnectionGrants.agentId, input.agentId),
          eq(agentConnectionGrants.connectedAccountId, input.connectedAccountId),
          isNull(agentConnectionGrants.revokedAt),
        ),
      )
      .returning({ id: agentConnectionGrants.id });
    ctx.setSubject("connected_account", input.connectedAccountId);
    if (revoked.length > 0) {
      ctx.queueEvent("connection.revokedFromAgent", {
        id: input.connectedAccountId,
        agentId: input.agentId,
      });
    }
    return { revoked: revoked.length };
  },
});

/**
 * Every account this agent may use, asked by the agent itself.
 *
 * The first consumer of the grant, and the shape every later one follows: an
 * agent sees the accounts it was given and cannot discover the rest exist.
 * Credentials are never selected — the sync layer reads those, not the agent.
 */
export const listMyConnections = defineService({
  name: "connections.mine",
  summary: "The connected accounts this worker has been given.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(
    row({
      id: uuid,
      provider: z.string(),
      email: z.string().nullable(),
      displayName: z.string().nullable(),
      status: z.string(),
      access: z.enum(ACCESS),
    }),
  ),
  handler: async (_input, ctx) => {
    const agent = await agentForActor(ctx.tx, ctx.actor);
    return accountsForAgent(ctx, agent.id);
  },
});

export default [
  listConnectionGrants,
  grantAccountToAgent,
  revokeAccountFromAgent,
  listMyConnections,
];
