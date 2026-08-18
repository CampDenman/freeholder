// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Contribution channel (C1.30–C1.34).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { contacts } from "@/core/contacts/schema";
import { createContact, mergeContacts } from "@/core/contacts/service";
import { contactPrivacySources } from "@/core/privacy/service";
import { signPayload } from "@/core/webhooks/sign";
import { contributions } from "@/core/contribute/schema";
import {
  deliverQueuedContribution,
  isCanonicalProjectHub,
  isSelfHub,
  spokeBodyJson,
} from "@/core/contribute/deliver";
import {
  determineContribution,
  getContributeSettings,
  ingestContribution,
  listContributions,
  recordContributionStatus,
  runContributeReplyJob,
  setHubEnabled,
  submitContribution,
  updateContributeSettings,
} from "@/core/contribute/service";
import type { Actor } from "@/core/service";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

const AGENT: Actor = {
  kind: "agent",
  keyName: "writer",
  scopes: ["contacts.*"],
};

const CONTRIBUTE_AGENT: Actor = {
  kind: "agent",
  keyName: "reporter",
  scopes: ["contribute.*"],
};

describe("contribute helpers", () => {
  it("treats an empty hub URL as this instance", () => {
    expect(isSelfHub("", "https://shop.example")).toBe(true);
    expect(isSelfHub("https://shop.example", "https://shop.example/admin")).toBe(
      true,
    );
    expect(isSelfHub("https://freeholder.ai", "https://shop.example")).toBe(
      false,
    );
  });

  it("treats freeholder.ai as the canonical project hub", () => {
    expect(isCanonicalProjectHub("https://freeholder.ai")).toBe(true);
    expect(isCanonicalProjectHub("https://www.freeholder.ai")).toBe(true);
    expect(isCanonicalProjectHub("https://shop.example")).toBe(false);
  });
});

describe.runIf(hasDatabase)("contribute channel", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine, 30_000);
  afterAll(closeDb);

  it("files locally when the hub URL is empty and never calls ingest", async () => {
    await updateContributeSettings.call({ hubUrl: "" }, OWNER);
    const filed = await submitContribution.call(
      {
        kind: "bug",
        title: "Nav wraps on a narrow phone",
        body: "The disclosure works; the desktop list still peeks through.",
        email: "owner@example.test",
        name: "Owner",
      },
      OWNER,
    );
    expect(filed.status).toBe("received");
    expect(filed.contactId).toBeTruthy();
    const [contact] = await db()
      .select()
      .from(contacts)
      .where(eq(contacts.email, "owner@example.test"));
    expect(contact?.source).toBe("contribute");
  });

  it("queues delivery when a remote hub is configured", async () => {
    await updateContributeSettings.call(
      { hubUrl: "https://freeholder.ai" },
      OWNER,
    );
    const filed = await submitContribution.call(
      {
        kind: "feature",
        title: "Save a section once",
        body: "I want to reuse a block tree on two pages.",
      },
      OWNER,
    );
    expect(filed.status).toBe("queued");
  });

  it("refuses hub ingest until hub mode is on", async () => {
    const error = await failure(
      ingestContribution.call(
        {
          kind: "bug",
          title: "Anything",
          body: "Should not land on a spoke.",
        },
        ANONYMOUS,
      ),
    );
    expect(error.code).toBe("not_found");
  });

  it("ingests on the hub, is idempotent on hash, and resolves a contact", async () => {
    await updateContributeSettings.call({ hubEnabled: true, hubUrl: "" }, OWNER);
    const first = await ingestContribution.call(
      {
        kind: "question",
        title: "Can a fork point the hub elsewhere?",
        body: "We run our own review inbox.",
        email: "Ada@Example.test",
        name: "Ada",
        source: "public_form",
      },
      ANONYMOUS,
    );
    expect(first.status).toBe("received");
    expect(first.reporterEmail).toBe("ada@example.test");
    const again = await ingestContribution.call(
      {
        kind: "question",
        title: "Can a fork point the hub elsewhere?",
        body: "We run our own review inbox.",
        email: "ada@example.test",
        source: "public_form",
      },
      ANONYMOUS,
    );
    expect(again.id).toBe(first.id);
    const listed = await listContributions.call({}, OWNER);
    expect(listed).toHaveLength(1);
  });

  it("refuses a patch without a DCO sign-off", async () => {
    await updateContributeSettings.call({ hubUrl: "" }, OWNER);
    const error = await failure(
      submitContribution.call(
        {
          kind: "patch",
          title: "Fix the nav wrap",
          body: "diff --git a/x b/x",
        },
        OWNER,
      ),
    );
    expect(error.code).toBe("validation");
    expect(error.message).toContain("Developer Certificate of Origin");
  });

  it("refuses a security report and points at SECURITY.md", async () => {
    await updateContributeSettings.call({ hubEnabled: true, hubUrl: "" }, OWNER);
    const error = await failure(
      ingestContribution.call(
        {
          kind: "security",
          title: "Please read this privately",
          body: "A made-up finding.",
        },
        ANONYMOUS,
      ),
    );
    expect(error.code).toBe("validation");
    expect(error.message).toContain("SECURITY.md");
  });

  it("accepts a signed spoke delivery and rejects a bad signature", async () => {
    const settings = await updateContributeSettings.call(
      { hubEnabled: true, hubUrl: "", rotateReceiveSecret: true },
      OWNER,
    );
    const secret = settings.receiveSecret;
    expect(secret).toBeTruthy();
    const payload = {
      kind: "bug" as const,
      title: "Signed from a spoke",
      body: "The instance delivered this packet.",
      locale: "en",
      email: "spoke@example.test",
      includeDoctor: false,
      dcoAttested: false,
    };
    const hashSource = {
      kind: payload.kind,
      title: payload.title,
      body: payload.body,
      email: payload.email,
      locale: payload.locale,
    };
    const { createHash } = await import("node:crypto");
    const contentHash = createHash("sha256")
      .update(
        JSON.stringify({
          kind: hashSource.kind,
          title: hashSource.title.trim(),
          body: hashSource.body.trim(),
          email: hashSource.email,
          locale: hashSource.locale,
        }),
      )
      .digest("hex");
    const body = spokeBodyJson({
      kind: payload.kind,
      title: payload.title,
      body: payload.body,
      locale: "en",
      reporterEmail: payload.email,
      reporterName: null,
      includeDoctor: false,
      doctorReport: null,
      platformVersion: null,
      dcoAttested: false,
      dcoSigner: null,
      externalUrl: null,
      contentHash,
    });
    const signature = signPayload(secret!, body, Math.floor(Date.now() / 1000));
    const accepted = await ingestContribution.call(
      {
        ...payload,
        source: "spoke",
        contentHash,
        signature,
      },
      ANONYMOUS,
    );
    expect(accepted.source).toBe("spoke");

    const bad = await failure(
      ingestContribution.call(
        {
          ...payload,
          title: "Tampered",
          source: "spoke",
          contentHash,
          signature,
        },
        ANONYMOUS,
      ),
    );
    expect(bad.code).toBe("permission");
  });

  it("redacts secrets in an attached doctor snapshot", async () => {
    await updateContributeSettings.call({ hubUrl: "" }, OWNER);
    const filed = await submitContribution.call(
      {
        kind: "bug",
        title: "Health report attached",
        body: "Doctor said something was off.",
        includeDoctor: true,
        doctorReport: { verdict: "fail", token: "super-secret", note: "ok" },
      },
      OWNER,
    );
    expect(filed.includeDoctor).toBe(true);
    expect(filed.doctorReport).toMatchObject({
      verdict: "fail",
      token: "[redacted]",
      note: "ok",
    });
  });

  it("does not let a contacts-scoped agent submit", async () => {
    const error = await failure(
      submitContribution.call(
        {
          kind: "bug",
          title: "Should not work",
          body: "This key cannot file a report.",
        },
        AGENT,
      ),
    );
    expect(error.code).toBe("permission");
    const filed = await submitContribution.call(
      {
        kind: "bug",
        title: "Agent report",
        body: "Filed through MCP on the instance.",
      },
      CONTRIBUTE_AGENT,
    );
    expect(filed.source).toBe("mcp");
  });

  it("repoints on merge and redacts on privacy erase", async () => {
    await updateContributeSettings.call({ hubUrl: "" }, OWNER);
    const keep = await createContact.call(
      { name: "Keep", email: "keep@example.test" },
      OWNER,
    );
    await submitContribution.call(
      {
        kind: "docs",
        title: "Typo in the setup guide",
        body: "The recipe still says npm.",
        email: "drop@example.test",
        name: "Drop",
      },
      OWNER,
    );
    const [drop] = await db()
      .select()
      .from(contacts)
      .where(eq(contacts.email, "drop@example.test"));
    await mergeContacts.call(
      { survivingId: keep.id, duplicateId: drop!.id },
      OWNER,
    );
    const [moved] = await db()
      .select()
      .from(contributions)
      .where(eq(contributions.contactId, keep.id));
    expect(moved?.title).toContain("Typo");

    const source = contactPrivacySources().find(
      (item) => item.scope === "contribute.reports",
    );
    expect(source).toBeTruthy();
    await db().transaction(async (tx) => {
      const exported = await source!.exportData(tx, keep.id);
      expect(Array.isArray(exported) && exported).toHaveLength(1);
      await source!.erase(tx, keep.id, { requestId: "test" });
    });
    const [erased] = await db()
      .select()
      .from(contributions)
      .where(eq(contributions.id, moved!.id));
    expect(erased?.body).toBe("[erased]");
    expect(erased?.reporterEmail).toBeNull();
  });

  it("records a determination without inventing a checklist item", async () => {
    await updateContributeSettings.call({ hubEnabled: true, hubUrl: "" }, OWNER);
    const filed = await ingestContribution.call(
      {
        kind: "feature",
        title: "Dark-mode charts",
        body: "The traffic page is unreadable at night.",
        email: "charts@example.test",
      },
      ANONYMOUS,
    );
    const decided = await determineContribution.call(
      { id: filed.id, status: "accepted", checklistId: "C2.15" },
      OWNER,
    );
    expect(decided.status).toBe("accepted");
    expect(decided.checklistId).toBe("C2.15");
  });

  it("marks a queued row delivered when the hub answers", async () => {
    await updateContributeSettings.call(
      { hubUrl: "https://freeholder.ai" },
      OWNER,
    );
    const filed = await submitContribution.call(
      {
        kind: "bug",
        title: "Delivery probe",
        body: "The job should POST this once.",
      },
      OWNER,
    );
    const receipt = crypto.randomUUID();
    const result = await deliverQueuedContribution(filed.id, {
      hubUrl: "https://freeholder.ai",
      fetchImpl: async () =>
        new Response(JSON.stringify({ id: receipt }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    expect(result.status).toBe("delivered");
    expect(result.hubReceiptId).toBe(receipt);
    const settings = await getContributeSettings.call({}, OWNER);
    expect(settings.hubEnabled).toBe(false);
    expect(settings.hubUrl).toBe("https://freeholder.ai");
  });

  it("turns hub ingest on with a required boolean", async () => {
    const denied = await failure(
      ingestContribution.call(
        {
          kind: "bug",
          title: "Before the switch",
          body: "Should 404 while ingest is off.",
        },
        ANONYMOUS,
      ),
    );
    expect(denied.code).toBe("not_found");
    const on = await setHubEnabled.call({ enabled: true }, OWNER);
    expect(on.hubEnabled).toBe(true);
    const accepted = await ingestContribution.call(
      {
        kind: "bug",
        title: "After the switch",
        body: "Hub ingest is on.",
      },
      ANONYMOUS,
    );
    expect(accepted.status).toBe("received");
    const off = await setHubEnabled.call({ enabled: false }, OWNER);
    expect(off.hubEnabled).toBe(false);
  });

  it("replies a determination to the speaking instance", async () => {
    await updateContributeSettings.call(
      { hubUrl: "https://freeholder.ai" },
      OWNER,
    );
    const spoke = await submitContribution.call(
      {
        kind: "feature",
        title: "Please reply",
        body: "I want to hear back.",
      },
      OWNER,
    );
    const [spokeRow] = await db()
      .select()
      .from(contributions)
      .where(eq(contributions.id, spoke.id));
    expect(spokeRow?.replyToken).toBeTruthy();
    await setHubEnabled.call({ enabled: true }, OWNER);
    const hub = await ingestContribution.call(
      {
        kind: "feature",
        title: "Please reply on the hub",
        body: "A separate hash so this is the hub copy.",
        source: "spoke",
        spokeId: spoke.id,
        replyUrl: "https://shop.example/api/v1/contribute.recordStatus",
        replyToken: spokeRow!.replyToken!,
      },
      ANONYMOUS,
    );
    const decided = await determineContribution.call(
      { id: hub.id, status: "accepted", checklistId: "C2.12", note: "In the next editor pass." },
      OWNER,
    );
    expect(decided.status).toBe("accepted");
    const result = await runContributeReplyJob(
      { contributionId: hub.id, note: "In the next editor pass." },
      {
        fetchImpl: async (_url, init) => {
          const body = JSON.parse(String(init?.body));
          await recordContributionStatus.call(body, ANONYMOUS);
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
      },
    );
    expect(result.sent).toBe(true);
    const [updated] = await db()
      .select()
      .from(contributions)
      .where(eq(contributions.id, spoke.id));
    expect(updated?.status).toBe("accepted");
    expect(updated?.checklistId).toBe("C2.12");
    const bad = await failure(
      recordContributionStatus.call(
        {
          spokeId: spoke.id,
          replyToken: "not-the-token-value",
          status: "wontfix",
        },
        ANONYMOUS,
      ),
    );
    expect(bad.code).toBe("permission");
  });
});
