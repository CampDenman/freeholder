// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31: Paradise Modern as one more mail adapter. Mocked HTTP only — no
// request reaches the provider and no message is sent.
import { afterEach, describe, expect, it } from "vitest";
import { createParadiseMail } from "@/adapters/mail/paradise";
import { MailAdapterError, type OutboundEmail } from "@/adapters/mail/types";
import { bulkMail, mail, mailConfigurationStatus, resetMailForTests } from "@/adapters/mail";
import { setParadiseFetchForTests } from "@/adapters/paradise/http";
import { resetEnvForTests } from "@/core/env";
import { consentEvidenceFromRecord } from "@/core/mail/permission";

const changed = new Map<string, string | undefined>();
function environment(values: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(values)) {
    if (!changed.has(name)) changed.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetEnvForTests();
  resetMailForTests();
}

afterEach(() => {
  for (const [name, value] of changed) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  changed.clear();
  resetEnvForTests();
  resetMailForTests();
  setParadiseFetchForTests(undefined);
});

type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> };

function mockParadise(...responses: Array<{ status: number; body: unknown }>): Call[] {
  const calls: Call[] = [];
  let index = 0;
  setParadiseFetchForTests(async (url, init) => {
    calls.push({
      url,
      body: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {},
      headers: init.headers as Record<string, string>,
    });
    const next = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    return new Response(JSON.stringify(next.body), { status: next.status });
  });
  return calls;
}

const RECEIPT: OutboundEmail = {
  to: "customer@example.test",
  subject: "Your receipt",
  text: "Thanks.",
  from: "Aurora Coast <hello@auroracoast.test>",
  deliveryId: "00000000-0000-4000-8000-000000000001",
  permission: { purpose: "transactional", reason: "receipt", eventRef: "invoice:1:a" },
};

const EVIDENCE = {
  collectedAt: "2026-10-01T12:00:00.000Z",
  method: "double_opt_in" as const,
  statement: "Yes, email me the Aurora Coast newsletter.",
  source: "https://auroracoast.test/newsletter",
  evidenceRef: "freeholder-consent:abc",
};

const CAMPAIGN: OutboundEmail = {
  to: "reader@example.test",
  subject: "October news",
  text: "News.",
  deliveryId: "00000000-0000-4000-8000-000000000002",
  headers: {
    "List-Unsubscribe": "<https://auroracoast.test/unsubscribe?broadcastToken=t>",
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  },
  permission: { purpose: "marketing", evidence: EVIDENCE },
};

describe("Paradise Modern transactional mail", () => {
  it("declares the reason and event, splits the sender, and is idempotent", async () => {
    environment({ PARADISEMODERN_API_KEY: "site-key", PARADISEMODERN_URL: "https://paradisemodern.com/v1" });
    const calls = mockParadise({ status: 200, body: { success: true, messageId: "mg-1", deliveryId: "d-1" } });
    const adapter = createParadiseMail({ kind: "transactional", topic: "newsletter" });
    await expect(adapter.send(RECEIPT)).resolves.toEqual({ providerRef: "mg-1" });
    expect(calls[0]!.url).toBe("https://paradisemodern.com/api/site-self/email/send");
    expect(calls[0]!.headers["x-api-key"]).toBe("site-key");
    expect(calls[0]!.body).toMatchObject({
      to: "customer@example.test",
      from: "hello@auroracoast.test",
      fromName: "Aurora Coast",
      permission: { purpose: "transactional", reason: "receipt", eventRef: "invoice:1:a" },
      requestId: "freeholder:00000000-0000-4000-8000-000000000001",
    });
  });

  it("refuses a message with no permission basis and campaign mail on the wrong route", async () => {
    environment({ PARADISEMODERN_API_KEY: "site-key" });
    const calls = mockParadise({ status: 200, body: { messageId: "x" } });
    const adapter = createParadiseMail({ kind: "transactional", topic: "newsletter" });
    await expect(adapter.send({ ...RECEIPT, permission: undefined })).rejects.toBeInstanceOf(MailAdapterError);
    await expect(adapter.send(CAMPAIGN)).rejects.toThrow(/transactional sender/);
    expect(calls).toHaveLength(0);
  });

  it("classifies retryable and permanent refusals", async () => {
    environment({ PARADISEMODERN_API_KEY: "site-key" });
    const adapter = createParadiseMail({ kind: "transactional", topic: "newsletter" });
    mockParadise({ status: 502, body: { code: "EMAIL_NOT_SUBMITTED" } });
    expect(await adapter.send(RECEIPT).catch((error: MailAdapterError) => error.retryable)).toBe(true);
    mockParadise({ status: 409, body: { code: "EMAIL_REQUEST_IN_FLIGHT" } });
    expect(await adapter.send(RECEIPT).catch((error: MailAdapterError) => error.retryable)).toBe(true);
    mockParadise({ status: 402, body: { error: "insufficient_credit" } });
    expect(await adapter.send(RECEIPT).catch((error: MailAdapterError) => error.retryable)).toBe(true);
    mockParadise({ status: 400, body: { message: "Domain is not a verified Mailgun sending domain" } });
    expect(await adapter.send(RECEIPT).catch((error: MailAdapterError) => error.retryable)).toBe(false);
  });
});

describe("Paradise Modern campaign mail", () => {
  it("sends under the topic and keeps the site's own unsubscribe", async () => {
    environment({ PARADISEMODERN_API_KEY: "site-key" });
    const calls = mockParadise({ status: 200, body: { messageId: "mg-2", unsubscribe: "site" } });
    await createParadiseMail({ kind: "bulk", from: "news@auroracoast.test", topic: "aurora-news" }).send(CAMPAIGN);
    expect(calls[0]!.body).toMatchObject({
      permission: { purpose: "marketing", topic: "aurora-news" },
      listUnsubscribe: "<https://auroracoast.test/unsubscribe?broadcastToken=t>",
      listUnsubscribePost: "List-Unsubscribe=One-Click",
    });
    // The evidence is never sent on the send itself.
    expect(JSON.stringify(calls[0]!.body)).not.toContain("freeholder-consent");
  });

  it("refuses a recipient with no acceptable opt-in before any request", async () => {
    environment({ PARADISEMODERN_API_KEY: "site-key" });
    const calls = mockParadise({ status: 200, body: { messageId: "x" } });
    const error = await createParadiseMail({ kind: "bulk", topic: "newsletter" })
      .send({ ...CAMPAIGN, permission: { purpose: "marketing", evidence: null } })
      .then(() => undefined, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(MailAdapterError);
    expect((error as MailAdapterError).retryable).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("refuses campaign mail without the site's one-click unsubscribe", async () => {
    environment({ PARADISEMODERN_API_KEY: "site-key" });
    const calls = mockParadise({ status: 200, body: { messageId: "x" } });
    await expect(
      createParadiseMail({ kind: "bulk", topic: "newsletter" }).send({ ...CAMPAIGN, headers: undefined }),
    ).rejects.toThrow(/one-click unsubscribe/);
    expect(calls).toHaveLength(0);
  });

  it("records retained consent once when the provider has not seen it, then sends as a new request", async () => {
    environment({ PARADISEMODERN_API_KEY: "site-key" });
    const calls = mockParadise(
      { status: 403, body: { message: "Email send failed", code: "EMAIL_CONSENT_REQUIRED", retryable: false } },
      { status: 201, body: { id: 1 } },
      { status: 200, body: { messageId: "mg-3" } },
    );
    await expect(
      createParadiseMail({ kind: "bulk", topic: "newsletter" }).send(CAMPAIGN),
    ).resolves.toEqual({ providerRef: "mg-3" });
    expect(calls.map((call) => call.url.replace("https://paradisemodern.com", ""))).toEqual([
      "/api/site-self/email/send",
      "/api/site-self/email/consent",
      "/api/site-self/email/send",
    ]);
    expect(calls[1]!.body).toEqual({
      email: "reader@example.test",
      topic: "newsletter",
      directPermission: true,
      ...EVIDENCE,
    });
    // The provider keeps a refusal as the first request id's final answer.
    expect(calls[2]!.body.requestId).toBe(`${calls[0]!.body.requestId as string}:consented`);
  });

  it("stops when the provider still refuses after the consent is recorded", async () => {
    environment({ PARADISEMODERN_API_KEY: "site-key" });
    mockParadise(
      { status: 403, body: { code: "EMAIL_CONSENT_REQUIRED" } },
      { status: 400, body: { message: "Direct opt-in evidence required" } },
    );
    const error = await createParadiseMail({ kind: "bulk", topic: "newsletter" })
      .send(CAMPAIGN)
      .then(() => undefined, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(MailAdapterError);
    expect((error as MailAdapterError).retryable).toBe(false);
  });

  it("mirrors a withdrawal to the provider's consent ledger", async () => {
    environment({ PARADISEMODERN_API_KEY: "site-key" });
    const calls = mockParadise({ status: 200, body: { success: true } });
    const adapter = createParadiseMail({ kind: "bulk", topic: "newsletter" });
    expect(adapter.requiresPermission).toBe(true);
    await adapter.recordWithdrawal!("reader@example.test");
    expect(calls[0]!.url).toBe("https://paradisemodern.com/api/site-self/email/consent/withdraw");
    expect(calls[0]!.body).toEqual({ email: "reader@example.test" });
    mockParadise({ status: 503, body: {} });
    expect(
      await adapter.recordWithdrawal!("reader@example.test").catch((error: MailAdapterError) => error.retryable),
    ).toBe(true);
  });

  it("verifies a sender against the site's sending domain at the provider", async () => {
    environment({ PARADISEMODERN_API_KEY: "site-key" });
    const adapter = createParadiseMail({ kind: "bulk", topic: "newsletter" });
    mockParadise({ status: 200, body: { domain: "auroracoast.test", mailgunDomainStatus: "active" } });
    expect((await adapter.verifySender!({ email: "news@auroracoast.test" })).status).toBe("verified");
    mockParadise({ status: 200, body: { domain: "auroracoast.test", mailgunDomainStatus: "pending" } });
    expect((await adapter.verifySender!({ email: "news@auroracoast.test" })).status).toBe("pending");
    mockParadise({ status: 200, body: { domain: "auroracoast.test", mailgunDomainStatus: "active" } });
    expect((await adapter.verifySender!({ email: "news@elsewhere.test" })).status).toBe("failed");
  });
});

describe("configuration", () => {
  it("selects Paradise Modern for either route and names what is missing", () => {
    environment({
      MAIL_ADAPTER: "paradise",
      MAIL_BULK_ADAPTER: "paradise",
      MAIL_BULK_FROM: undefined,
      PARADISEMODERN_API_KEY: undefined,
    });
    const status = mailConfigurationStatus();
    expect(status.transactional).toMatchObject({ provider: "paradise", delivers: false, missing: ["PARADISEMODERN_API_KEY"] });
    expect(status.bulk.missing).toEqual(["MAIL_BULK_FROM", "PARADISEMODERN_API_KEY"]);
    expect(() => mail()).toThrow(/PARADISEMODERN_API_KEY/);

    environment({ PARADISEMODERN_API_KEY: "site-key", MAIL_BULK_FROM: "news@auroracoast.test" });
    expect(mail()).toMatchObject({ id: "paradise", kind: "transactional", delivers: true });
    expect(bulkMail()).toMatchObject({ id: "paradise", kind: "bulk" });
    // Provider-managed feedback: there is no delivery webhook to configure.
    expect(mailConfigurationStatus().bulk).toMatchObject({
      sendConfigured: true,
      feedbackConfigured: true,
      webhookPath: null,
    });
  });
});

describe("consent evidence for a permission-checking provider", () => {
  const base = {
    id: "11111111-1111-4111-8111-111111111111",
    state: "granted" as const,
    method: "double_opt_in" as const,
    termsVersion: "2026-09",
    sourceUrl: "/newsletter",
    ip: "203.0.113.9",
    evidence: { statement: "Yes, send me the Aurora Coast newsletter." },
    occurredAt: new Date("2026-10-01T12:00:00Z"),
  };

  it("translates a double opt-in with its retained wording", () => {
    expect(consentEvidenceFromRecord(base, "https://auroracoast.test")).toEqual({
      collectedAt: "2026-10-01T12:00:00.000Z",
      method: "double_opt_in",
      statement: "Yes, send me the Aurora Coast newsletter.",
      source: "https://auroracoast.test/newsletter",
      evidenceRef: "freeholder-consent:11111111-1111-4111-8111-111111111111",
      recipientIp: "203.0.113.9",
    });
  });

  it("describes the record rather than inventing wording nobody kept", () => {
    const evidence = consentEvidenceFromRecord(
      { ...base, method: "preference_center", evidence: {}, ip: "not-an-ip" },
      "https://auroracoast.test",
    );
    expect(evidence?.method).toBe("unchecked_checkbox");
    expect(evidence?.statement).toContain("Freeholder consent record");
    expect(evidence).not.toHaveProperty("recipientIp");
  });

  it("refuses methods a provider cannot accept as direct permission", () => {
    for (const method of ["import", "verbal", "system", "form"] as const) {
      expect(consentEvidenceFromRecord({ ...base, method }, "https://auroracoast.test")).toBeNull();
    }
    expect(consentEvidenceFromRecord({ ...base, state: "withdrawn" }, "https://auroracoast.test")).toBeNull();
  });
});
