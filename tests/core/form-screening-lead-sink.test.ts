// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The form-screening and lead-sink categories (C3.33, C3.34, MASTER.md §12).
//
// What matters here is what each one can *not* do: screening can only add a
// quarantine reason, never drop one, and fails closed without a secret to
// seal with; it sends only the provider's required fields plus the screened
// text. The lead sink is its own switch, copies only accepted submissions,
// and retries only what is worth retrying.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setParadiseFetchForTests } from "@/adapters/paradise/http";
import { formScreening } from "@/adapters/form-screening";
import { SCREENING_TIMEOUT_MS } from "@/adapters/form-screening/paradise";
import { leadSink, LeadSinkRetryableError } from "@/adapters/lead-sink";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { HONEYPOT_FIELD, issueStamp, STAMP_FIELD } from "@/modules/forms/antispam";
import type { FormField } from "@/modules/forms/fields";
import { copySubmissionToLeadSink, leadCopy } from "@/modules/forms/lead-sink";
import { formSubmissions } from "@/modules/forms/schema";
import {
  BLOCKED_REASON,
  openScreening,
  screeningReason,
  screenPublicSubmission,
  sealScreening,
  UNCHECKED_REASON,
} from "@/modules/forms/screening";
import { createForm, submitForm } from "@/modules/forms/service";
import { ANONYMOUS, closeDb, hasDatabase, OWNER, STAFF, truncateSpine } from "../helpers/spine";

const NAMES = [
  "PARADISEMODERN_API_KEY",
  "PARADISEMODERN_URL",
  "FREEHOLDER_PLAYGROUND",
  "FORM_SCREENING_PROVIDER",
  "LEAD_SINK_PROVIDER",
  "SESSION_SECRET",
] as const;
const prior = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));

type Call = { url: string; init: RequestInit; body: Record<string, unknown> };
let calls: Call[] = [];
let reply: () => Response | Promise<Response> = () => new Response("{}", { status: 200 });

function configure(values: Partial<Record<(typeof NAMES)[number], string>>): void {
  for (const name of NAMES) {
    if (name === "SESSION_SECRET") continue;
    delete process.env[name];
  }
  Object.assign(process.env, values);
  resetEnvForTests();
}

beforeEach(() => {
  configure({ PARADISEMODERN_API_KEY: "site-key", PARADISEMODERN_URL: "https://pm.example.test" });
  calls = [];
  reply = () => new Response(JSON.stringify({ allow: true }), { status: 200 });
  setParadiseFetchForTests(async (url, init) => {
    const raw = typeof init.body === "string" ? init.body : "{}";
    calls.push({ url, init, body: JSON.parse(raw) as Record<string, unknown> });
    return reply();
  });
});

afterEach(() => {
  setParadiseFetchForTests(undefined);
  for (const name of NAMES) {
    if (prior[name] === undefined) delete process.env[name];
    else process.env[name] = prior[name];
  }
  resetEnvForTests();
  vi.restoreAllMocks();
});

const FIELDS: FormField[] = [
  { key: "name", label: "Your name", kind: "text", required: true },
  { key: "email", label: "Email", kind: "email", required: true },
  { key: "phone", label: "Phone", kind: "tel" },
  { key: "message", label: "Message", kind: "multiline", required: true },
] as FormField[];

const answers = (over: Record<string, unknown> = {}) => ({
  name: "Grace Hopper",
  email: "grace@example.test",
  phone: "+1 604 555 0100",
  message: "Do you shoot in November?",
  [STAMP_FIELD]: issueStamp(new Date(Date.now() - 30_000)),
  ...over,
});

describe("choosing a provider", () => {
  it("is off by default, and each category is its own switch", () => {
    expect(formScreening()).toBeNull();
    expect(leadSink()).toBeNull();
    configure({ PARADISEMODERN_API_KEY: "k", FORM_SCREENING_PROVIDER: "paradise" });
    expect(formScreening()?.displayName).toBe("Paradise Modern");
    expect(leadSink()).toBeNull();
    configure({ PARADISEMODERN_API_KEY: "k", LEAD_SINK_PROVIDER: "paradise" });
    expect(formScreening()).toBeNull();
    expect(leadSink()?.displayName).toBe("Paradise Modern");
  });

  it("needs the site key, and a public playground never chooses one", () => {
    configure({ FORM_SCREENING_PROVIDER: "paradise", LEAD_SINK_PROVIDER: "paradise" });
    expect(formScreening()).toBeNull();
    expect(leadSink()).toBeNull();
    configure({
      PARADISEMODERN_API_KEY: "k",
      FORM_SCREENING_PROVIDER: "paradise",
      LEAD_SINK_PROVIDER: "paradise",
      FREEHOLDER_PLAYGROUND: "1",
    });
    expect(formScreening()).toBeNull();
    expect(leadSink()).toBeNull();
  });
});

describe("the screening adapter", () => {
  beforeEach(() => {
    configure({
      PARADISEMODERN_API_KEY: "site-key",
      PARADISEMODERN_URL: "https://pm.example.test",
      FORM_SCREENING_PROVIDER: "paradise",
    });
  });

  it("sends only the form reference, the client address and the screened text", async () => {
    const outcome = await formScreening()!.assess({
      formRef: "freeholder:contact",
      clientIp: "203.0.113.9",
      message: "Do you shoot in November?",
    });
    expect(outcome).toBe("allow");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://pm.example.test/api/shield/assess");
    expect(calls[0]!.body).toEqual({
      form_id: "freeholder:contact",
      client_ip: "203.0.113.9",
      submission: { message: "Do you shoot in November?" },
    });
    expect(JSON.stringify(calls[0]!.body)).not.toMatch(/user_agent|name|email|phone/);
    expect(calls[0]!.init.signal).toBeDefined();
    expect(SCREENING_TIMEOUT_MS).toBe(4_000);
  });

  it("reads a refusal as blocked, and anything else as no evidence", async () => {
    const request = { formRef: "f", clientIp: "203.0.113.9", message: "x" };
    reply = () => new Response(JSON.stringify({ allow: false }), { status: 200 });
    expect(await formScreening()!.assess(request)).toBe("blocked");
    reply = () => new Response(JSON.stringify({ code: "shield_not_enabled" }), { status: 503 });
    expect(await formScreening()!.assess(request)).toBe("unavailable");
    reply = () => new Response("not json", { status: 200 });
    expect(await formScreening()!.assess(request)).toBe("unavailable");
    reply = () => Promise.reject(new Error("timed out"));
    expect(await formScreening()!.assess(request)).toBe("unavailable");
  });
});

describe("the sealed verdict", () => {
  const values = answers();

  it("opens only for the same form and the same answers", () => {
    const seal = sealScreening("allow", "contact", values)!;
    expect(openScreening(seal, "contact", values)).toBe("allow");
    expect(openScreening(seal, "other-form", values)).toBeNull();
    expect(openScreening(seal, "contact", { ...values, message: "Different words" })).toBeNull();
    expect(openScreening(seal.replace(".allow.", ".blocked."), "contact", values)).toBeNull();
  });

  it("expires", () => {
    const old = sealScreening("allow", "contact", values, new Date(Date.now() - 16 * 60 * 1000))!;
    expect(openScreening(old, "contact", values)).toBeNull();
  });

  it("is never issued, and never accepted, without SESSION_SECRET", () => {
    const seal = sealScreening("allow", "contact", values)!;
    delete process.env.SESSION_SECRET;
    resetEnvForTests();
    expect(sealScreening("allow", "contact", values)).toBeUndefined();
    expect(openScreening(seal, "contact", values)).toBeNull();
  });

  it("adds a reason only for anonymous submissions while a provider is on", () => {
    const allow = sealScreening("allow", "contact", values);
    const blocked = sealScreening("blocked", "contact", values);
    const unavailable = sealScreening("unavailable", "contact", values);
    // Off: nothing, whatever arrives.
    expect(screeningReason(blocked, "contact", values, ANONYMOUS)).toBeNull();
    configure({ PARADISEMODERN_API_KEY: "k", FORM_SCREENING_PROVIDER: "paradise" });
    expect(screeningReason(allow, "contact", values, ANONYMOUS)).toBeNull();
    expect(screeningReason(unavailable, "contact", values, ANONYMOUS)).toBeNull();
    expect(screeningReason(blocked, "contact", values, ANONYMOUS)).toBe(BLOCKED_REASON);
    expect(screeningReason(undefined, "contact", values, ANONYMOUS)).toBe(UNCHECKED_REASON);
    expect(screeningReason("v1.allow.1.forged", "contact", values, ANONYMOUS)).toBe(UNCHECKED_REASON);
    expect(screeningReason(undefined, "contact", values, OWNER)).toBeNull();
  });
});

describe("what a lead copy carries", () => {
  it("names every field the privacy notice lists, and nothing from the request", () => {
    const copy = leadCopy(
      { slug: "contact", fields: FIELDS },
      { id: "00000000-0000-4000-8000-000000000001", data: answers({ [STAMP_FIELD]: undefined }), sourceUrl: "/contact" },
    );
    expect(copy).toEqual({
      submissionId: "00000000-0000-4000-8000-000000000001",
      formSlug: "contact",
      name: "Grace Hopper",
      email: "grace@example.test",
      phone: "+1 604 555 0100",
      message: "Do you shoot in November?",
      answers: {
        "Your name": "Grace Hopper",
        Email: "grace@example.test",
        Phone: "+1 604 555 0100",
        Message: "Do you shoot in November?",
      },
      pageUrl: "http://localhost:3000/contact",
    });
  });
});

describe.runIf(hasDatabase)("screening and the lead sink with a database", () => {
  beforeEach(async () => {
    await truncateSpine();
    await createForm.call({ slug: "contact", name: "Contact", fields: FIELDS }, STAFF);
  });

  afterAll(async () => {
    await closeDb();
  });

  async function only() {
    const rows = await db().select().from(formSubmissions);
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  it("leaves submissions alone while screening is off", async () => {
    await submitForm.call({ slug: "contact", values: answers() }, ANONYMOUS);
    expect((await only()).status).toBe("received");
    expect(calls).toHaveLength(0);
  });

  it("screens before the transaction and passes an allowed submission", async () => {
    configure({ PARADISEMODERN_API_KEY: "k", PARADISEMODERN_URL: "https://pm.example.test", FORM_SCREENING_PROVIDER: "paradise" });
    const values = answers();
    const screening = await screenPublicSubmission({
      slug: "contact",
      values,
      request: { ip: "203.0.113.9", userAgent: "Agent/1.0" },
    });
    expect(calls[0]!.body).toEqual({
      form_id: "freeholder:contact",
      client_ip: "203.0.113.9",
      submission: { message: "Do you shoot in November?" },
    });
    await submitForm.call({ slug: "contact", values, screening }, ANONYMOUS);
    expect((await only()).status).toBe("received");
  });

  it("quarantines a blocked submission, and still keeps it", async () => {
    configure({ PARADISEMODERN_API_KEY: "k", PARADISEMODERN_URL: "https://pm.example.test", FORM_SCREENING_PROVIDER: "paradise" });
    reply = () => new Response(JSON.stringify({ allow: false }), { status: 200 });
    const values = answers();
    const screening = await screenPublicSubmission({ slug: "contact", values, request: { ip: "203.0.113.9" } });
    await submitForm.call({ slug: "contact", values, screening }, ANONYMOUS);
    const row = await only();
    expect(row.status).toBe("spam");
    expect(row.spamReasons).toEqual([BLOCKED_REASON]);
  });

  it("never clears a reason a trap raised", async () => {
    configure({ PARADISEMODERN_API_KEY: "k", PARADISEMODERN_URL: "https://pm.example.test", FORM_SCREENING_PROVIDER: "paradise" });
    const values = answers({ [HONEYPOT_FIELD]: "filled" });
    const screening = sealScreening("allow", "contact", values);
    await submitForm.call({ slug: "contact", values, screening }, ANONYMOUS);
    const row = await only();
    expect(row.status).toBe("spam");
    expect(row.spamReasons.join(" ")).toContain("hidden from people");
  });

  it("falls back to the traps when the provider is down or there is no address", async () => {
    configure({ PARADISEMODERN_API_KEY: "k", PARADISEMODERN_URL: "https://pm.example.test", FORM_SCREENING_PROVIDER: "paradise" });
    reply = () => Promise.reject(new Error("down"));
    const values = answers();
    const screening = await screenPublicSubmission({ slug: "contact", values, request: { ip: "203.0.113.9" } });
    await submitForm.call({ slug: "contact", values, screening }, ANONYMOUS);
    expect((await only()).status).toBe("received");

    calls = [];
    const noAddress = await screenPublicSubmission({ slug: "contact", values, request: undefined });
    expect(calls).toHaveLength(0);
    expect(openScreening(noAddress, "contact", values)).toBe("unavailable");
  });

  it("holds an anonymous submission that skipped screening as unchecked", async () => {
    configure({ PARADISEMODERN_API_KEY: "k", FORM_SCREENING_PROVIDER: "paradise" });
    await submitForm.call({ slug: "contact", values: answers() }, ANONYMOUS);
    const row = await only();
    expect(row.status).toBe("spam");
    expect(row.spamReasons).toEqual([UNCHECKED_REASON]);
  });

  it("copies an accepted submission only when the lead sink is on", async () => {
    const { submissionId } = await submitForm.call(
      { slug: "contact", values: answers(), sourceUrl: "/contact" },
      ANONYMOUS,
    );
    await copySubmissionToLeadSink({ submissionId });
    expect(calls).toHaveLength(0);

    configure({ PARADISEMODERN_API_KEY: "k", PARADISEMODERN_URL: "https://pm.example.test", LEAD_SINK_PROVIDER: "paradise" });
    await copySubmissionToLeadSink({ submissionId });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://pm.example.test/api/collect/lead");
    expect(calls[0]!.body).toMatchObject({
      name: "Grace Hopper",
      email: "grace@example.test",
      phone: "+1 604 555 0100",
      message: "Do you shoot in November?",
      source: "form:contact",
      externalId: submissionId,
      referer: "http://localhost:3000/contact",
    });
  });

  it("never copies quarantined submissions", async () => {
    configure({ PARADISEMODERN_API_KEY: "k", LEAD_SINK_PROVIDER: "paradise" });
    const { submissionId } = await submitForm.call(
      { slug: "contact", values: answers({ [HONEYPOT_FIELD]: "filled" }) },
      ANONYMOUS,
    );
    await copySubmissionToLeadSink({ submissionId });
    expect(calls).toHaveLength(0);
  });

  it("retries a transient failure and logs a permanent refusal", async () => {
    configure({ PARADISEMODERN_API_KEY: "k", PARADISEMODERN_URL: "https://pm.example.test", LEAD_SINK_PROVIDER: "paradise" });
    const { submissionId } = await submitForm.call({ slug: "contact", values: answers() }, ANONYMOUS);
    reply = () => new Response("{}", { status: 503 });
    await expect(copySubmissionToLeadSink({ submissionId })).rejects.toBeInstanceOf(LeadSinkRetryableError);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    reply = () => new Response(JSON.stringify({ code: "INVALID" }), { status: 400 });
    await expect(copySubmissionToLeadSink({ submissionId })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]![0])).not.toContain("grace@example.test");
  });
});
