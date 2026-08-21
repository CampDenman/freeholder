// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Per-agent, per-connection grants (C4.10, MASTER.md §41).
//
// The question a scope cannot answer: not "may this agent read calendars" but
// "may it read *this* calendar". Everything here is about the absence of a
// grant being a refusal.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { agentConnectionGrants, connectedAccounts } from "@/core/connections/schema";
import {
  grantAccountToAgent,
  listConnectionGrants,
  listMyConnections,
  revokeAccountFromAgent,
} from "@/core/connections/grants";
import { flagConnection, recordConnection } from "@/core/connections/service";
import { connectAgentRuntime, hireAgent } from "@/core/agents/service";
import type { Actor } from "@/core/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

/** An owner session whose second factor is fresh enough to grant. */
const VERIFIED: Actor = {
  ...OWNER,
  security: {
    twoFactorRequired: false,
    twoFactorEnrolled: true,
    twoFactorVerified: true,
    stepUpValid: true,
  },
};

function asAgent(name: string): Actor {
  return { kind: "agent", keyName: `agent:${name}`, scopes: ["connections.*"] };
}

describe.runIf(hasDatabase)("connection grants", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  }, 60_000);
  afterAll(closeDb);

  async function setup(agentName = "Triager") {
    const link = await connectAgentRuntime.call(
      { name: `runtime-${agentName}`, kind: "inbound" },
      OWNER,
    );
    const agent = await hireAgent.call(
      {
        connectionId: link.id,
        name: agentName,
        role: "worker",
        toolScopes: ["connections.mine"],
      },
      OWNER,
    );
    const account = await recordConnection.call(
      {
        userId: OWNER.userId,
        provider: "google",
        providerAccountId: `acct-${agentName}`,
        email: `${agentName.toLowerCase()}@example.test`,
        scopesGranted: ["calendar.readonly"],
        credentials: { refreshToken: "secret-token" },
      },
      VERIFIED,
    );
    return { agent, account };
  }

  it("shows an agent nothing until it is granted something", async () => {
    const { agent, account } = await setup();
    // Scope alone is not access: the key holds connections.* and still sees
    // an empty list, because whose account is a separate question.
    expect(await listMyConnections.call({}, asAgent("Triager"))).toEqual([]);

    await grantAccountToAgent.call(
      { agentId: agent.id, connectedAccountId: account.id, access: "read" },
      VERIFIED,
    );
    const visible = await listMyConnections.call({}, asAgent("Triager"));
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({
      id: account.id,
      provider: "google",
      access: "read",
    });
    // Never the credential. The sync layer reads that; an agent does not.
    expect(JSON.stringify(visible)).not.toContain("secret-token");
  });

  it("keeps one agent's grant from showing another agent anything", async () => {
    const first = await setup("Triager");
    await setup("Nosy");
    await grantAccountToAgent.call(
      { agentId: first.agent.id, connectedAccountId: first.account.id },
      VERIFIED,
    );
    expect(await listMyConnections.call({}, asAgent("Nosy"))).toEqual([]);
  });

  it("revokes without forgetting that access once existed", async () => {
    const { agent, account } = await setup();
    await grantAccountToAgent.call(
      { agentId: agent.id, connectedAccountId: account.id },
      VERIFIED,
    );
    const revoked = await revokeAccountFromAgent.call(
      { agentId: agent.id, connectedAccountId: account.id, reason: "No longer needed." },
      OWNER,
    );
    expect(revoked).toEqual({ revoked: 1 });
    expect(await listMyConnections.call({}, asAgent("Triager"))).toEqual([]);

    // "Did that agent ever have access, and when did it stop" has an answer.
    const history = await listConnectionGrants.call({ includeRevoked: true }, OWNER);
    expect(history).toHaveLength(1);
    expect(history[0]?.revokedAt).toBeTruthy();
    expect(await listConnectionGrants.call({}, OWNER)).toHaveLength(0);

    // Re-granting reuses the row rather than piling up duplicates.
    await grantAccountToAgent.call(
      { agentId: agent.id, connectedAccountId: account.id, access: "write" },
      VERIFIED,
    );
    const again = await listConnectionGrants.call({}, OWNER);
    expect(again).toHaveLength(1);
    expect(again[0]?.access).toBe("write");
  });

  it("revokes every agent's grant when the provider revokes the account", async () => {
    const { agent, account } = await setup();
    await grantAccountToAgent.call(
      { agentId: agent.id, connectedAccountId: account.id },
      VERIFIED,
    );
    await flagConnection.call(
      { id: account.id, status: "revoked", reason: "The provider withdrew consent." },
      OWNER,
    );
    // The owner's list of who can reach their mailbox stays true at exactly
    // the moment it matters.
    expect(await listConnectionGrants.call({}, OWNER)).toHaveLength(0);
    const [grant] = await db()
      .select()
      .from(agentConnectionGrants)
      .where(eq(agentConnectionGrants.agentId, agent.id));
    expect(grant?.revokedReason).toContain("withdrew consent");
  });

  it("keeps grants but withholds use while an account needs reconnecting", async () => {
    const { agent, account } = await setup();
    await grantAccountToAgent.call(
      { agentId: agent.id, connectedAccountId: account.id },
      VERIFIED,
    );
    await flagConnection.call(
      { id: account.id, status: "needs_reconnect", reason: "The token expired." },
      OWNER,
    );
    // A token expiring is not the owner changing their mind, so the grant
    // survives — but the account reports the state that explains the pause.
    expect(await listConnectionGrants.call({}, OWNER)).toHaveLength(1);
    const visible = await listMyConnections.call({}, asAgent("Triager"));
    expect(visible[0]?.status).toBe("needs_reconnect");
  });

  it("refuses to let an agent grant itself anything", async () => {
    const { agent, account } = await setup();
    const attempts: Array<() => Promise<unknown>> = [
      () =>
        grantAccountToAgent.call(
          { agentId: agent.id, connectedAccountId: account.id },
          asAgent("Triager"),
        ),
      () =>
        revokeAccountFromAgent.call(
          { agentId: agent.id, connectedAccountId: account.id },
          asAgent("Triager"),
        ),
      () => listConnectionGrants.call({}, asAgent("Triager")),
    ];
    for (const attempt of attempts) {
      expect((await failure(attempt())).code).toBe("permission");
    }
  });

  it("refuses to grant an account that has been revoked", async () => {
    const { agent, account } = await setup();
    await db()
      .update(connectedAccounts)
      .set({ status: "revoked" })
      .where(eq(connectedAccounts.id, account.id));
    const refused = await failure(
      grantAccountToAgent.call(
        { agentId: agent.id, connectedAccountId: account.id },
        VERIFIED,
      ),
    );
    expect(refused.code).toBe("conflict");
    expect(refused.message).toContain("Reconnect");
  });
});
