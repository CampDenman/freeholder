// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The form-screening and lead-sink categories (C3.33, C3.34, MASTER.md §12).
//
// What matters here is what each one can *not* do. Screening can only add a
// quarantine reason, never drop one; it runs after Freeholder's own traps and
// budget, fails closed without a secret to seal with, and sends only the
// provider's required fields plus the screened text. The lead sink is its own
// switch, copies only accepted submissions from a form that showed its
// notice, and never drops a lead silently.
import { eq, sql } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { contactPrivacySources, addRetentionException, createDataRequest, verifyDataRequest, fulfillDataRequest } from "@/core/privacy/service";
import { listLeadCopyRecovery, reconcileLeadCopy, retryLeadCopy } from "@/modules/forms/lead-copy-services";
import { finishLeadCopy } from "@/modules/forms/lead-copy-state";
import { dataRequests, dataRequestArtifacts } from "@/core/privacy/schema";
import { getJob } from "@/core/jobs";
import { eraseFormLeadCopies, minimizeLeadCopies } from "@/modules/forms/lead-copy-privacy";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setParadiseFetchForTests } from "@/adapters/paradise/http";
import { formScreening } from "@/adapters/form-screening";
import { SCREENING_TIMEOUT_MS } from "@/adapters/form-screening/paradise";
import { leadSink } from "@/adapters/lead-sink";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { enqueue } from "@/core/events/outbox";
import type { Actor } from "@/core/service";
import { outboxEvents } from "@/core/events/schema";
import { HONEYPOT_FIELD, issueStamp, STAMP_FIELD } from "@/modules/forms/antispam";
import { RenderedForm } from "@/modules/forms/block";
import type { Translate } from "@/core/i18n";
import type { FormField } from "@/modules/forms/fields";
import { copySubmissionToLeadSink, leadCopy } from "@/modules/forms/lead-sink";
import { issueLeadNotice, LEAD_NOTICE_FIELD, openLeadNotice } from "@/modules/forms/lead-notice";
import { formLeadCopies, formSubmissions } from "@/modules/forms/schema";
import {
  BLOCKED_REASON,
  openScreening,
  screenedText,
  screeningReason,
  sealScreening,
  sealSiteSubmission,
  UNCHECKED_REASON,
} from "@/modules/forms/screening";
import { createForm, submitForm, removeForm, purgeForm, purgeExpiredForms } from "@/modules/forms/service";
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

/** An API key acting through the public API. */
const API_KEY = { kind: "agent" as const, keyName: "crm-import", scopes: ["forms.submit"] };

const PM = { PARADISEMODERN_API_KEY: "k", PARADISEMODERN_URL: "https://pm.example.test" };
const SCREENING = { ...PM, FORM_SCREENING_PROVIDER: "paradise" };
const SINK = { ...PM, LEAD_SINK_PROVIDER: "paradise" };

beforeEach(() => {
  configure(PM);
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
  [LEAD_NOTICE_FIELD]: issueLeadNotice("contact", "Copy my enquiry to Paradise Modern for follow-up."),
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
    configure(SCREENING);
    expect(formScreening()?.displayName).toBe("Paradise Modern");
    expect(leadSink()).toBeNull();
    configure(SINK);
    expect(formScreening()).toBeNull();
    expect(leadSink()?.displayName).toBe("Paradise Modern");
  });

  it("needs the site key, and a public playground never chooses one", () => {
    configure({ FORM_SCREENING_PROVIDER: "paradise", LEAD_SINK_PROVIDER: "paradise" });
    expect(formScreening()).toBeNull();
    expect(leadSink()).toBeNull();
    configure({ ...SCREENING, LEAD_SINK_PROVIDER: "paradise", FREEHOLDER_PLAYGROUND: "1" });
    expect(formScreening()).toBeNull();
    expect(leadSink()).toBeNull();
  });
});

describe("the screening adapter", () => {
  beforeEach(() => configure(SCREENING));

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

  it("screens only a multi-line answer, never a name or an address in its place", () => {
    expect(screenedText(FIELDS, answers())).toBe("Do you shoot in November?");
    const noMessageBox = FIELDS.filter((field) => field.kind !== "multiline");
    expect(screenedText(noMessageBox, answers({ name: "A very long name that is longer than anything" }))).toBe("");
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
    configure(SCREENING);
    // Fails closed: with screening on, nothing counts as checked.
    expect(screeningReason(seal, "contact", values, ANONYMOUS)).toBe(UNCHECKED_REASON);
    expect(screeningReason(undefined, "contact", values, ANONYMOUS)).toBe(UNCHECKED_REASON);
  });

  it("adds a reason only for anonymous submissions while a provider is on", () => {
    const allow = sealScreening("allow", "contact", values);
    const blocked = sealScreening("blocked", "contact", values);
    const unavailable = sealScreening("unavailable", "contact", values);
    const unscreened = sealScreening("unscreened", "contact", values);
    // Off: nothing, whatever arrives.
    expect(screeningReason(blocked, "contact", values, ANONYMOUS)).toBeNull();
    configure(SCREENING);
    expect(screeningReason(allow, "contact", values, ANONYMOUS)).toBeNull();
    expect(screeningReason(unavailable, "contact", values, ANONYMOUS)).toBeNull();
    expect(screeningReason(unscreened, "contact", values, ANONYMOUS)).toBeNull();
    expect(screeningReason(blocked, "contact", values, ANONYMOUS)).toBe(BLOCKED_REASON);
    expect(screeningReason("v1.allow.1.forged", "contact", values, ANONYMOUS)).toBe(UNCHECKED_REASON);
    // No seal at all (an anonymous API or MCP call) is unchecked too.
    expect(screeningReason(undefined, "contact", values, ANONYMOUS)).toBe(UNCHECKED_REASON);
    // Authenticated callers are exempt from the seal.
    expect(screeningReason(blocked, "contact", values, OWNER)).toBeNull();
    expect(screeningReason(undefined, "contact", values, API_KEY)).toBeNull();
  });
});

describe("the notice beside every form", () => {
  const t: Translate = (key, params) =>
    `${key}${typeof params?.provider === "string" ? `[${params.provider}]` : ""}`;
  const render = () =>
    renderToStaticMarkup(
      createElement(RenderedForm, {
        form: { slug: "contact", name: "Contact", fields: FIELDS, submitLabel: null, successMessage: null, stamp: "s" },
        failed: false,
        t,
      }),
    );

  it("says nothing while both categories are off", () => {
    expect(render()).not.toContain("forms.public.notice");
  });

  it("names the provider for each category that is on, and only those", () => {
    configure(SCREENING);
    expect(render()).toContain("forms.public.notice.screening[Paradise Modern]");
    expect(render()).not.toContain("forms.public.notice.leadSink");
    configure({ ...SCREENING, LEAD_SINK_PROVIDER: "paradise" });
    expect(render()).toContain("forms.public.notice.leadSink[Paradise Modern]");
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

describe("lead page-address disclosure (C3.34)", () => {
  it("does not copy query or fragment credentials in a public page address", () => {
    const copy = leadCopy({ slug: "contact", fields: FIELDS }, { id: "00000000-0000-4000-8000-000000000079", data: answers(), sourceUrl: "/contact?access=synthetic-private-link#synthetic-private-fragment" });
    expect(copy.pageUrl).toBe("http://localhost:3000/contact");
  });
  it("does not copy a private appointment capability from the page path", () => {
    const copy = leadCopy({ slug: "contact", fields: FIELDS }, { id: "00000000-0000-4000-8000-000000000079", data: answers(), sourceUrl: "/portal/appointments/synthetic-private-capability/intake" });
    expect(copy.pageUrl).toBe("http://localhost:3000/");
  });
});

describe("built-in private attribution paths", () => {
  it.each(["/gift/fictional-private-capability", "/capture/fictional-private-capability"])("omits the private capability in %s", path => {
    const copy = leadCopy({ slug: "contact", fields: FIELDS }, { id: "00000000-0000-4000-8000-000000000079", data: answers(), sourceUrl: path });
    expect(copy.pageUrl).toBe("http://localhost:3000/");
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

  // Simulate the durable crash window between submission commit and dispatch.
  // The real service, audit and outbox are used; only its later delivery is explicit.
  async function submitCommitted(input: Parameters<typeof submitForm.call>[0], actor: Actor) {
    return db().transaction(async tx => {
      const queued: Array<{ eventName: string; payload: unknown; id?: string }> = [];
      const result = await submitForm.call(input, actor, { tx, queued });
      for (const event of queued) await enqueue(tx, event.eventName, event.payload);
      return result;
    });
  }
  async function only() {
    const rows = await db().select().from(formSubmissions);
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  async function submittedPayload(submissionId?: string): Promise<Record<string, unknown>> {
    const rows = await db().select().from(outboxEvents);
    const event = rows.find((row) => row.eventName === "forms.submitted" && (!submissionId || (row.payload as Record<string, unknown>).submissionId === submissionId));
    return event!.payload as Record<string, unknown>;
  }

  it("leaves submissions alone and seals nothing while both categories are off", async () => {
    expect(await sealSiteSubmission({ slug: "contact", values: answers(), request: { ip: "203.0.113.9" } })).toBeUndefined();
    await submitCommitted({ slug: "contact", values: answers() }, ANONYMOUS);
    expect((await only()).status).toBe("received");
    expect(calls).toHaveLength(0);
  });

  it("screens before the transaction and passes an allowed submission", async () => {
    configure(SCREENING);
    const values = answers();
    const screening = await sealSiteSubmission({
      slug: "contact",
      values,
      request: { ip: "203.0.113.9", userAgent: "Agent/1.0" },
    });
    expect(calls[0]!.body).toEqual({
      form_id: "freeholder:contact",
      client_ip: "203.0.113.9",
      submission: { message: "Do you shoot in November?" },
    });
    await submitCommitted({ slug: "contact", values, screening }, ANONYMOUS);
    expect((await only()).status).toBe("received");
    expect((await submittedPayload()).fromSiteForm).toBe(true);
  });

  it("never asks the provider about what the traps already flag", async () => {
    configure(SCREENING);
    const values = answers({ [HONEYPOT_FIELD]: "filled" });
    const screening = await sealSiteSubmission({ slug: "contact", values, request: { ip: "203.0.113.9" } });
    expect(calls).toHaveLength(0);
    expect(openScreening(screening, "contact", values)).toBe("unscreened");
    await submitCommitted({ slug: "contact", values, screening }, ANONYMOUS);
    const row = await only();
    expect(row.status).toBe("spam");
    expect(row.spamReasons.join(" ")).toContain("hidden from people");
    expect(row.spamReasons).not.toContain(UNCHECKED_REASON);
  });

  it("stops asking the provider once a client is over its budget", async () => {
    configure(SCREENING);
    for (let i = 0; i < 31; i += 1) {
      await sealSiteSubmission({ slug: "contact", values: answers({ message: `Try ${i}` }), request: { ip: "203.0.113.77" } });
    }
    expect(calls).toHaveLength(30);
  });

  it("quarantines a blocked submission, and still keeps it", async () => {
    configure(SCREENING);
    reply = () => new Response(JSON.stringify({ allow: false }), { status: 200 });
    const values = answers();
    const screening = await sealSiteSubmission({ slug: "contact", values, request: { ip: "203.0.113.9" } });
    await submitCommitted({ slug: "contact", values, screening }, ANONYMOUS);
    const row = await only();
    expect(row.status).toBe("spam");
    expect(row.spamReasons).toEqual([BLOCKED_REASON]);
  });

  it("never clears a reason a trap raised", async () => {
    configure(SCREENING);
    const values = answers({ [HONEYPOT_FIELD]: "filled" });
    const screening = sealScreening("allow", "contact", values);
    await submitCommitted({ slug: "contact", values, screening }, ANONYMOUS);
    const row = await only();
    expect(row.status).toBe("spam");
    expect(row.spamReasons.join(" ")).toContain("hidden from people");
  });

  it("falls back to the traps when the provider is down or there is no address", async () => {
    configure(SCREENING);
    reply = () => Promise.reject(new Error("down"));
    const values = answers();
    const screening = await sealSiteSubmission({ slug: "contact", values, request: { ip: "203.0.113.9" } });
    await submitCommitted({ slug: "contact", values, screening }, ANONYMOUS);
    expect((await only()).status).toBe("received");

    calls = [];
    const noAddress = await sealSiteSubmission({ slug: "contact", values, request: undefined });
    expect(calls).toHaveLength(0);
    expect(openScreening(noAddress, "contact", values)).toBe("unavailable");
  });

  it("holds an anonymous API submission without a seal as unchecked", async () => {
    configure({ ...SCREENING, LEAD_SINK_PROVIDER: "paradise" });
    await submitCommitted({ slug: "contact", values: answers() }, ANONYMOUS);
    const row = await only();
    expect(row.status).toBe("spam");
    expect(row.spamReasons).toEqual([UNCHECKED_REASON]);
    expect(calls).toHaveLength(0);
  });

  it("accepts an API-key submission without a seal, and never copies it", async () => {
    configure({ ...SCREENING, LEAD_SINK_PROVIDER: "paradise" });
    const { submissionId } = await submitCommitted({ slug: "contact", values: answers() }, API_KEY);
    expect((await only()).status).toBe("received");
    const payload = await submittedPayload();
    expect(payload.fromSiteForm).toBe(false);
    await copySubmissionToLeadSink(payload);
    expect(calls).toHaveLength(0);
    expect(submissionId).toBe(payload.submissionId);
  });

  it("copies an accepted site-form submission only when the lead sink is on", async () => {
    const values = answers();
    const sealed = sealScreening("unscreened", "contact", values);
    await submitCommitted({ slug: "contact", values, sourceUrl: "/contact", screening: sealed }, ANONYMOUS);
    const payload = await submittedPayload();
    await copySubmissionToLeadSink(payload);
    expect(calls).toHaveLength(0);

    configure(SINK);
    // With only the lead sink on, a site form still seals, without asking anybody.
    expect(openScreening(await sealSiteSubmission({ slug: "contact", values, request: undefined }), "contact", values)).toBe("unscreened");
    expect(calls).toHaveLength(0);
    await copySubmissionToLeadSink(payload);
    expect(calls).toHaveLength(0);
    const freshValues = answers();
    const fresh = await submitCommitted({ slug: "contact", values: freshValues, sourceUrl: "/contact", screening: sealScreening("unscreened", "contact", freshValues) }, ANONYMOUS);
    const freshPayload = await submittedPayload(fresh.submissionId);
    reply = () => new Response(JSON.stringify({ accepted: true, id: "original-lead-1" }), { status: 201 });
    await copySubmissionToLeadSink(freshPayload);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://pm.example.test/api/collect/lead");
    expect(calls[0]!.body).toMatchObject({
      name: "Grace Hopper",
      email: "grace@example.test",
      phone: "+1 604 555 0100",
      message: "Do you shoot in November?",
      source: "form:contact",
      externalId: freshPayload.submissionId,
      referer: "http://localhost:3000/contact",
    });
  });

  it("does not copy a screening-only submission into a lead destination enabled later", async () => {
    configure(SCREENING);
    const values = answers();
    const screening = await sealSiteSubmission({ slug: "contact", values, request: { ip: "203.0.113.9" } });
    await submitCommitted({ slug: "contact", values, screening }, ANONYMOUS);
    const payload = await submittedPayload(); expect(payload.fromSiteForm).toBe(true);
    calls = [];
    configure({ ...SINK, PARADISEMODERN_API_KEY: "fictional-replacement-lead-site-key", PARADISEMODERN_URL: "https://replacement-lead.example.test" });
    await copySubmissionToLeadSink(payload);
    expect(calls).toHaveLength(0);
  });

  it("does not repeat an original lead copy after its accepted reply is lost", async () => {
    configure(SINK);
    const values = answers();
    const screening = await sealSiteSubmission({ slug: "contact", values, request: undefined });
    await submitCommitted({ slug: "contact", values, screening }, ANONYMOUS);
    const payload = await submittedPayload(); let remoteCopies = 0;
    setParadiseFetchForTests(async () => {
      remoteCopies++;
      if (remoteCopies === 1) throw new Error("Synthetic remote lead accepted before its reply was lost");
      return new Response(JSON.stringify({ id: remoteCopies, accepted: true }), { status: 201 });
    });
    await copySubmissionToLeadSink(payload).catch(() => undefined);
    await copySubmissionToLeadSink(payload).catch(() => undefined);
    expect(remoteCopies).toBe(1);
  });

  it("never copies quarantined submissions", async () => {
    configure(SINK);
    const values = answers({ [HONEYPOT_FIELD]: "filled" });
    const { submissionId } = await submitCommitted(
      { slug: "contact", values, screening: sealScreening("unscreened", "contact", values) },
      ANONYMOUS,
    );
    await expect(copySubmissionToLeadSink({ submissionId, fromSiteForm: true })).rejects.toThrow("legacy");
    expect(calls).toHaveLength(0);
  });

  it("retains unknown physical outcomes and blocks replay without disclosing answers", async () => {
    configure(SINK);
    const values = answers();
    const { submissionId } = await submitCommitted({ slug: "contact", values, screening: sealScreening("unscreened", "contact", values) }, ANONYMOUS);
    const payload = await submittedPayload(submissionId);
    reply = () => new Response(JSON.stringify({ code: "UNAVAILABLE", echo: "grace@example.test" }), { status: 503 });
    await expect(copySubmissionToLeadSink(payload)).rejects.toThrow("unknown");
    await expect(copySubmissionToLeadSink(payload)).rejects.toThrow("review");
    expect(calls).toHaveLength(1);
    const [copy] = await db().select().from(formLeadCopies);
    expect(copy!.state).toBe("unknown");
    expect(JSON.stringify(copy!.attempts)).not.toContain("grace@example.test");
    expect(copy!.encryptedRequest).not.toContain("grace@example.test");
  });
  async function acceptedCopy() {
    configure(SINK);
    const values = answers();
    const submission = await submitCommitted({ slug: "contact", values, sourceUrl: "/contact?access=synthetic-private-link", screening: sealScreening("unscreened", "contact", values) }, ANONYMOUS);
    return submittedPayload(submission.submissionId);
  }
  const HUMAN = { ...OWNER, security: { twoFactorRequired: false, twoFactorEnrolled: true, twoFactorVerified: true, stepUpValid: true } };
  const review = (copy: typeof formLeadCopies.$inferSelect, outcome: "copied" | "not_copied" = "not_copied") => ({ id: copy.id, expectedRevision: copy.revision, operationId: copy.attempts[0]!.id, outcome, originalResourceEvidence: "Fictional provider independently identified the original account and request.", finalProviderEvidence: "Fictional exact original provider operation has this verified final outcome.", stoppedCallerEvidence: "Fictional original caller processes and all remote pending operations are stopped.", providerOperationRef: "fictional-provider-operation-79", confirmation: "ORIGINAL LEAD OUTCOME VERIFIED" });
  it("delivers one actual post-commit inline lead and refuses replay", async () => {
    configure(SINK); reply = () => new Response('{"accepted":true,"id":79}', { status: 201 });
    const values = answers();
    const result = await submitForm.call({ slug: "contact", values, screening: sealScreening("unscreened", "contact", values) }, ANONYMOUS);
    expect(calls).toHaveLength(1);
    await copySubmissionToLeadSink(await submittedPayload(result.submissionId));
    expect(calls).toHaveLength(1);
    expect((await db().select().from(formLeadCopies))[0]!.state).toBe("copied");
  });
  it("refuses a replacement lead account and restores the original frozen request", async () => {
    const payload = await acceptedCopy();
    const [copy] = await db().select().from(formLeadCopies);
    await db().update(formSubmissions).set({ data: { email: "replacement@example.test", message: "Edited after admission" } });
    configure({ ...SINK, PARADISEMODERN_API_KEY: "fictional-replacement-key", PARADISEMODERN_URL: "https://replacement-lead.example.test" });
    await expect(copySubmissionToLeadSink(payload)).rejects.toThrow("original"); expect(calls).toHaveLength(0);
    configure(SINK); reply = () => new Response(JSON.stringify({ accepted: true, id: "original-79" }), { status: 201 });
    await copySubmissionToLeadSink(payload); await copySubmissionToLeadSink(payload);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ email: "grace@example.test", referer: "http://localhost:3000/contact" });
    expect(JSON.stringify(calls[0]!.body)).not.toContain("synthetic-private-link");
    expect((await db().select().from(formLeadCopies).where(eq(formLeadCopies.id, copy!.id)))[0]!.attempts[0]!.observed).toBe("copied");
  });
  it("preserves the original provider binding across configured wrapping-key rotation", async () => {
    const payload = await acceptedCopy();
    const [original] = await db().select().from(formLeadCopies);
    const key = process.env.CREDENTIAL_KEY, previous = process.env.CREDENTIAL_KEY_PREVIOUS;
    expect(key).toBeTruthy();
    try {
      process.env.CREDENTIAL_KEY = "1122334455667788".repeat(4);
      process.env.CREDENTIAL_KEY_PREVIOUS = key;
      resetEnvForTests();
      reply = () => new Response('{"accepted":true,"id":"fictional-original-after-rotation"}', { status: 201 });
      await copySubmissionToLeadSink(payload);
      expect(calls).toHaveLength(1);
      const [after] = await db().select().from(formLeadCopies);
      expect(after?.state).toBe("copied"); expect(after?.resourceDigest).toBe(original!.resourceDigest);
    } finally {
      if (key === undefined) delete process.env.CREDENTIAL_KEY; else process.env.CREDENTIAL_KEY = key;
      if (previous === undefined) delete process.env.CREDENTIAL_KEY_PREVIOUS; else process.env.CREDENTIAL_KEY_PREVIOUS = previous;
      resetEnvForTests();
    }
  });
  it("refuses a replacement provider key even when the original wrapping key is retained", async () => {
    const payload = await acceptedCopy();
    const key = process.env.CREDENTIAL_KEY, previous = process.env.CREDENTIAL_KEY_PREVIOUS;
    expect(key).toBeTruthy();
    try {
      process.env.CREDENTIAL_KEY = "1122334455667788".repeat(4);
      process.env.CREDENTIAL_KEY_PREVIOUS = key;
      process.env.PARADISEMODERN_API_KEY = "fictional-replacement-provider-key";
      resetEnvForTests();
      await expect(copySubmissionToLeadSink(payload)).rejects.toThrow("original");
      expect(calls).toHaveLength(0);
      expect((await db().select().from(formLeadCopies))[0]?.attempts).toEqual([]);
    } finally {
      if (key === undefined) delete process.env.CREDENTIAL_KEY; else process.env.CREDENTIAL_KEY = key;
      if (previous === undefined) delete process.env.CREDENTIAL_KEY_PREVIOUS; else process.env.CREDENTIAL_KEY_PREVIOUS = previous;
      resetEnvForTests();
    }
  });
  it("keeps invalid accepted replies unknown and never replays them", async () => {
    const payload = await acceptedCopy(); reply = () => new Response('{"accepted":false,"id":79}', { status: 200 });
    await expect(copySubmissionToLeadSink(payload)).rejects.toThrow("unknown");
    await expect(copySubmissionToLeadSink(payload)).rejects.toThrow("review"); expect(calls).toHaveLength(1);
  });
  it("retries an explicit rate-limit refusal using the same original request", async () => {
    const payload = await acceptedCopy(); reply = () => new Response('{}', { status: 429 });
    await expect(copySubmissionToLeadSink(payload)).rejects.toThrow("rate limit");
    reply = () => new Response('{"accepted":true,"id":79}', { status: 201 });
    await copySubmissionToLeadSink(payload); expect(calls).toHaveLength(2); expect(calls[0]!.body).toEqual(calls[1]!.body);
    const [copy] = await db().select().from(formLeadCopies); expect(copy!.attempts.map(attempt => attempt.observed)).toEqual(["not_copied", "copied"]);
  });
  it("requires fresh human proof before admitting exactly one original-account retry", async () => {
    await db().insert(users).values({ id: OWNER.userId, email: "owner@example.test", role: "owner" });
    const payload = await acceptedCopy(); reply = () => Promise.reject(new Error("Fictional lost original reply"));
    await expect(copySubmissionToLeadSink(payload)).rejects.toThrow("unknown");
    const [copy] = await db().select().from(formLeadCopies); const proof = review(copy!);
    for (const actor of [{ kind: "system" as const }, API_KEY, { ...HUMAN, keyScopes: ["forms.reconcileLeadCopy"] }]) await expect(reconcileLeadCopy.call(proof, actor)).rejects.toMatchObject({ code: "permission" });
    await expect(reconcileLeadCopy.call(proof, { ...HUMAN, security: { ...HUMAN.security, stepUpValid: false } })).rejects.toMatchObject({ code: "step_up_required" });
    await reconcileLeadCopy.call(proof, HUMAN);
    const [reviewed] = await db().select().from(formLeadCopies); expect(reviewed!.attempts[0]!.observed).toBe("unknown"); expect(reviewed!.attempts[0]!.humanOutcome).toBe("not_copied");
    const retry = { id: reviewed!.id, expectedRevision: reviewed!.revision, confirmation: "RETRY ORIGINAL LEAD COPY" };
    reply = () => new Response('{"accepted":true,"id":79}', { status: 201 });
    await retryLeadCopy.call(retry, HUMAN); await expect(retryLeadCopy.call(retry, HUMAN)).rejects.toMatchObject({ code: "conflict" });
    const event = (await db().select().from(outboxEvents)).find(event => event.eventName === "forms.leadCopyRequested")!;
    reply = () => new Response('{"accepted":true,"id":79}', { status: 201 });
    await copySubmissionToLeadSink(event.payload); expect(calls).toHaveLength(2);
    const dto = await listLeadCopyRecovery.call({}, HUMAN); expect(JSON.stringify(dto)).not.toMatch(/resourceDigest|requestDigest|encryptedRequest|credentialFingerprint|grace@example.test/);
  });
  it("preserves copied erasure as pending until original-provider removal is verified", async () => {
    await db().insert(users).values({ id: OWNER.userId, email: "owner@example.test", role: "owner" });
    const payload = await acceptedCopy(); reply = () => new Response('{"accepted":true,"id":"fictional-provider-operation-79"}', { status: 201 });
    await copySubmissionToLeadSink(payload);
    const [submission] = await db().select().from(formSubmissions);
    const request = await createDataRequest.call({ contactId: submission!.contactId!, request: { kind: "erasure" } }, HUMAN);
    const source = contactPrivacySources().find(source => source.scope === "forms.leadCopies")!;
    const result = await db().transaction(tx => source.erase(tx, submission!.contactId!, { requestId: request.id }));
    expect(result.pendingJobs).toHaveLength(1);
    const [retired] = await db().select().from(formLeadCopies); expect(retired!.retiredAt).toBeTruthy(); expect(retired!.encryptedRequest).toBeNull(); expect(retired!.providerRef).toBeNull();
    await reconcileLeadCopy.call({ ...review(retired!, "copied"), remoteErasureEvidence: "Fictional original provider confirms this exact lead and all copies are erased." }, HUMAN);
    expect(await db().transaction(tx => minimizeLeadCopies(tx, [retired!.id], true))).toEqual([]);
    const [minimized] = await db().select().from(formLeadCopies); expect(minimized!.encryptedRequest).toBeNull(); expect(minimized!.attempts[0]!.observed).toBe("copied");
  });
  it("rechecks direct and inherited holds before lead payload minimization", async () => {
    await db().insert(users).values({ id: OWNER.userId, email: "owner@example.test", role: "owner" });
    const payload = await acceptedCopy(); reply = () => new Response('{"accepted":true,"id":79}', { status: 201 }); await copySubmissionToLeadSink(payload);
    const [submission] = await db().select().from(formSubmissions), [copy] = await db().select().from(formLeadCopies);
    const request = await createDataRequest.call({ contactId: submission!.contactId!, request: { kind: "erasure" } }, HUMAN);
    await addRetentionException.call({ dataRequestId: request.id, scope: "forms.submissions", reason: "legal_obligation", legalBasis: "Fictional independently documented original form evidence must be preserved." }, HUMAN);
    expect(await db().transaction(tx => minimizeLeadCopies(tx, [copy!.id]))).toEqual([copy!.id]);
    expect((await db().select().from(formLeadCopies))[0]!.encryptedRequest).toBeTruthy();
  });
  it("retains late positive replies after human resolution without inventing another call", async () => {
    await db().insert(users).values({ id: OWNER.userId, email: "owner@example.test", role: "owner" });
    const payload = await acceptedCopy(); reply = () => Promise.reject(new Error("Fictional lost reply")); await copySubmissionToLeadSink(payload).catch(() => undefined);
    const [copy] = await db().select().from(formLeadCopies); await reconcileLeadCopy.call(review(copy!, "not_copied"), HUMAN);
    await finishLeadCopy(copy!.id, copy!.attempts[0]!.id, { observed: "copied", providerRef: "late-original-79", response: { accepted: true, id: "late-original-79" } });
    const [late] = await db().select().from(formLeadCopies); expect(late!.state).toBe("unknown"); expect(late!.attempts[0]!).toMatchObject({ observed: "copied", humanOutcome: "not_copied" });
    await expect(copySubmissionToLeadSink(payload)).rejects.toThrow("review"); expect(calls).toHaveLength(1);
  });
  it.each(["intact", "corrupt"] as const)("reopens completed lead erasure after a contradictory late positive reply with an %s artifact", async artifactState => {
    await db().insert(users).values({ id: OWNER.userId, email: "owner@example.test", role: "owner" });
    const payload = await acceptedCopy(); reply = () => Promise.reject(new Error("Fictional lost original lead reply"));
    await expect(copySubmissionToLeadSink(payload)).rejects.toThrow("unknown");
    const [submission] = await db().select().from(formSubmissions), [copy] = await db().select().from(formLeadCopies);
    const request = await createDataRequest.call({ contactId: submission!.contactId!, request: { kind: "erasure" } }, HUMAN);
    await verifyDataRequest.call({ id: request.id, method: "Fictional original subject identity independently verified." }, HUMAN);
    const fulfilled = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, HUMAN);
    expect(fulfilled.request.status).toBe("in_progress");
    const receipt = fulfilled.artifact.body as { outcomes: Array<{ scope: string; pendingJobs?: string[] }> };
    const jobId = receipt.outcomes.find(outcome => outcome.scope === "forms.leadCopies")!.pendingJobs![0]!;
    const job = await getJob("core.eraseFormLeadCopies", jobId); expect(job).toBeTruthy();
    const [retired] = await db().select().from(formLeadCopies);
    await reconcileLeadCopy.call(review(retired!, "not_copied"), HUMAN);
    await eraseFormLeadCopies(job!.data);
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id, request.id)))[0]!.status).toBe("completed");
    await finishLeadCopy(copy!.id, copy!.attempts[0]!.id, { observed: "copied", providerRef: "contradictory-late-original-79", response: { accepted: true, id: "contradictory-late-original-79" } });
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id, request.id)))[0]!.status).toBe("in_progress");
    const [artifact] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, request.id));
    const reopened = artifact!.body as { outcomes: Array<{ scope: string; outcome: string }> };
    expect(reopened.outcomes.find(outcome => outcome.scope === "forms.leadCopies")!.outcome).toBe("pending");
    const [late] = await db().select().from(formLeadCopies);
    await reconcileLeadCopy.call({ ...review(late!, "copied"), providerOperationRef: "contradictory-late-original-79", remoteErasureEvidence: "Fictional original provider confirms final removal after the contradictory late positive." }, HUMAN);
    const [resolved] = await db().select().from(formLeadCopies);
    expect(resolved!.attempts[0]!.reviewHistory?.map(review => review.outcome)).toEqual(["not_copied", "copied"]);
    const latest = (await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, request.id)))[0]!.body as { outcomes: Array<{ scope: string; pendingJobs?: string[] }> };
    const repairJob = await getJob("core.eraseFormLeadCopies", latest.outcomes.find(outcome => outcome.scope === "forms.leadCopies")!.pendingJobs![0]!);
    if (artifactState === "corrupt") {
      const [originalArtifact] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, request.id));
      const corrupted = { ...(originalArtifact!.body as Record<string, unknown>), note: "Fictional parseable original artifact corruption." };
      await db().update(dataRequestArtifacts).set({ body: corrupted }).where(eq(dataRequestArtifacts.id, originalArtifact!.id));
      await expect(eraseFormLeadCopies(repairJob!.data)).rejects.toThrow(/receipt|recovery/i);
      expect((await db().select().from(dataRequests).where(eq(dataRequests.id, request.id)))[0]!.status).toBe("in_progress");
      const [unrepaired] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, request.id));
      expect(unrepaired!.body).toEqual(corrupted);
      expect(unrepaired!.sha256).toBe(originalArtifact!.sha256);
      expect((await db().select().from(formLeadCopies))[0]!.privacyPending).toBe(true);
      return;
    }
    await eraseFormLeadCopies(repairJob!.data);
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id, request.id)))[0]!.status).toBe("completed");
    expect((await db().select().from(formLeadCopies))[0]!.encryptedRequest).toBeNull();
  });
  it("requires original human evidence for legacy history and never binds it to today's account", async () => {
    await db().insert(users).values({ id: OWNER.userId, email: "owner@example.test", role: "owner" });
    await submitCommitted({ slug: "contact", values: answers() }, ANONYMOUS);
    const [submission] = await db().select().from(formSubmissions);
    const [legacy] = await db().transaction(async tx => {
      await tx.execute(sql`select set_config('freeholder.lead_copy_v1','1',true)`);
      return tx.insert(formLeadCopies).values({ submissionId: submission!.id, kind: "legacy_review", state: "unknown" }).returning();
    });
    const request = await createDataRequest.call({ contactId: submission!.contactId!, request: { kind: "erasure" } }, HUMAN);
    const source = contactPrivacySources().find(source => source.scope === "forms.leadCopies")!;
    const pending = await db().transaction(tx => source.erase(tx, submission!.contactId!, { requestId: request.id })); expect(pending.pendingJobs).toHaveLength(1);
    const [retired] = await db().select().from(formLeadCopies);
    await reconcileLeadCopy.call({ id: retired!.id, expectedRevision: retired!.revision, outcome: "copied", providerOperationRef: "fictional-original-legacy-reference", originalResourceEvidence: "Fictional independent proof identifies the original historical provider account.", finalProviderEvidence: "Fictional original provider confirms the exact historical copied enquiry.", stoppedCallerEvidence: "Fictional all original callers and pending remote operations are positively stopped.", remoteErasureEvidence: "Fictional original provider confirms this exact historical copy and duplicates removed.", confirmation: "ORIGINAL LEAD OUTCOME VERIFIED" }, HUMAN);
    expect(await db().transaction(tx => minimizeLeadCopies(tx, [legacy!.id], true))).toEqual([]);
    const [reviewed] = await db().select().from(formLeadCopies); expect(reviewed!.attempts).toEqual([]); expect(reviewed!.originalBaseUrl).toBeNull(); expect(reviewed!.resourceDigest).toBeNull(); expect(reviewed!.legacyOutcome).toBe("copied");
    await expect(retryLeadCopy.call({ id: reviewed!.id, expectedRevision: reviewed!.revision, confirmation: "RETRY ORIGINAL LEAD COPY" }, HUMAN)).rejects.toMatchObject({ code: "conflict" });
    expect(calls).toHaveLength(0);
  });
  it("prepares settled original lead witnesses before a confirmed form purge", async () => {
    const payload = await acceptedCopy(); reply = () => new Response('{}', { status: 400 }); await copySubmissionToLeadSink(payload);
    const [copy] = await db().select().from(formLeadCopies);
    const [submission] = await db().select().from(formSubmissions);
    await removeForm.call({ id: submission!.formId }, HUMAN);
    await purgeForm.call({ id: submission!.formId, confirmation: "PURGE" }, HUMAN);
    const [witness] = await db().select().from(formLeadCopies).where(eq(formLeadCopies.id, copy!.id));
    expect(witness).toMatchObject({ submissionId: null, encryptedRequest: null, providerRef: null, state: "not_copied" }); expect(witness!.attempts[0]!.observed).toBe("not_copied"); expect(calls).toHaveLength(1);
  });
  it("prepares unstarted original lead witnesses before the bounded trash sweep", async () => {
    await acceptedCopy(); const [copy] = await db().select().from(formLeadCopies), [submission] = await db().select().from(formSubmissions);
    await removeForm.call({ id: submission!.formId }, HUMAN);
    const { forms } = await import("@/modules/forms/schema");
    await db().update(forms).set({ trashedAt: new Date(Date.now() - 31 * 86_400_000) }).where(eq(forms.id, submission!.formId));
    expect(await purgeExpiredForms.call({}, { kind: "system" })).toEqual({ purged: 1 });
    expect((await db().select().from(formLeadCopies).where(eq(formLeadCopies.id, copy!.id)))[0]).toMatchObject({ submissionId: null, state: "cancelled", encryptedRequest: null });
    await copySubmissionToLeadSink(await submittedPayload(submission!.id)); expect(calls).toHaveLength(0);
  });
  it("blocks old-image reads and forged changes to observed lead journals", async () => {
    const payload = await acceptedCopy(); reply = () => new Response('{"accepted":true,"id":79}', { status: 201 }); await copySubmissionToLeadSink(payload);
    await expect(db().execute(sql`select data from form_submissions`)).rejects.toThrow();
    const [copy] = await db().select().from(formLeadCopies);
    await expect(db().transaction(async tx => { await tx.execute(sql`select set_config('freeholder.lead_copy_v1','1',true)`); await tx.update(formLeadCopies).set({ attempts: [] }).where(eq(formLeadCopies.id, copy!.id)); })).rejects.toThrow();
    await expect(db().delete(formLeadCopies)).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

});

describe("original rendered lead notice", () => {
  it("binds the rendered form, origin and original account without exposing credentials", () => {
    configure(SINK);
    const token = issueLeadNotice("contact", "Copy this enquiry to Paradise Modern for follow-up.")!;
    expect(token).not.toContain(PM.PARADISEMODERN_API_KEY + ":");
    expect(openLeadNotice(token, "contact")?.baseUrl).toBe(PM.PARADISEMODERN_URL);
    expect(openLeadNotice(token, "other")).toBeNull();
    expect(openLeadNotice(token + "x", "contact")).toBeNull();
    configure({ ...SINK, PARADISEMODERN_URL: "https://replacement.example.test" });
    expect(openLeadNotice(token, "contact")?.baseUrl).toBe(PM.PARADISEMODERN_URL);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 86_400_001);
    expect(openLeadNotice(token, "contact")).toBeNull();
  });
  it("does not issue a destination receipt for an unsafe provider address", () => {
    configure({ ...SINK, PARADISEMODERN_URL: "https://unsafe.example.test?synthetic=private" });
    expect(issueLeadNotice("contact", "Copy this enquiry to Paradise Modern for follow-up.")).toBeUndefined();
  });
});
