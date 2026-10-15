// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.32: PM Shield screening and lead capture for public forms. Mocked HTTP
// only; the database-backed submit journey is in forms.test.ts.
import { afterEach, describe, expect, it } from "vitest";
import { setParadiseFetchForTests } from "@/adapters/paradise/http";
import { resetEnvForTests } from "@/core/env";
import type { FormField } from "@/modules/forms/fields";
import {
  assessWithShield,
  forwardLead,
  leadBody,
  openScreening,
  sealScreening,
  screeningReason,
} from "@/modules/forms/paradise";

const changed = new Map<string, string | undefined>();
function environment(values: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(values)) {
    if (!changed.has(name)) changed.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetEnvForTests();
}

afterEach(() => {
  for (const [name, value] of changed) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  changed.clear();
  resetEnvForTests();
  setParadiseFetchForTests(undefined);
});

const FIELDS: FormField[] = [
  { key: "name", label: "Name", kind: "text", required: true },
  { key: "email", label: "Email", kind: "email", required: true },
  { key: "phone", label: "Phone", kind: "tel", required: false },
  { key: "message", label: "How can we help?", kind: "multiline", required: false },
];
const VALUES = {
  name: "Ada Lovelace",
  email: "ada@example.test",
  phone: "+1 250 555 0100",
  message: "Do you photograph weddings on Denman Island?",
  form_stamp: "1.sig",
};
const ANONYMOUS = { kind: "anonymous" } as const;

describe("sealed screening verdicts", () => {
  it("round-trips for the same form and answers only", () => {
    const token = sealScreening("allow", "contact", VALUES);
    expect(openScreening(token, "contact", { ...VALUES })).toBe("allow");
    expect(openScreening(token, "other-form", VALUES)).toBeNull();
    expect(openScreening(token, "contact", { ...VALUES, message: "Buy cheap watches" })).toBeNull();
  });

  it("rejects forged, tampered and stale seals", () => {
    const token = sealScreening("blocked", "contact", VALUES);
    expect(openScreening(token.replace(".blocked.", ".allow."), "contact", VALUES)).toBeNull();
    expect(openScreening("v1.allow.1.forged", "contact", VALUES)).toBeNull();
    const old = sealScreening("allow", "contact", VALUES, new Date(Date.now() - 16 * 60 * 1000));
    expect(openScreening(old, "contact", VALUES)).toBeNull();
  });

  it("only ever adds a quarantine reason, and only for anonymous traffic", () => {
    environment({ PARADISEMODERN_SHIELD: "on", PARADISEMODERN_API_KEY: "site-key" });
    const allowed = sealScreening("allow", "contact", VALUES);
    const unavailable = sealScreening("unavailable", "contact", VALUES);
    const blocked = sealScreening("blocked", "contact", VALUES);
    expect(screeningReason(allowed, "contact", VALUES, ANONYMOUS)).toBeNull();
    // PM down is not evidence about the visitor: the traps decide alone.
    expect(screeningReason(unavailable, "contact", VALUES, ANONYMOUS)).toBeNull();
    expect(screeningReason(blocked, "contact", VALUES, ANONYMOUS)).toMatch(/flagged/);
    // Skipping the form (the public API) cannot claim a verdict it lacks.
    expect(screeningReason(undefined, "contact", VALUES, ANONYMOUS)).toMatch(/not checked/);
    expect(screeningReason(undefined, "contact", VALUES, { kind: "system" })).toBeNull();

    environment({ PARADISEMODERN_SHIELD: "off" });
    expect(screeningReason(blocked, "contact", VALUES, ANONYMOUS)).toBeNull();
  });
});

describe("PM Shield assessment", () => {
  const request = { ip: "198.51.100.7", userAgent: "Mozilla/5.0" };

  it("sends only the name and prose, and seals PM's answer", async () => {
    environment({ PARADISEMODERN_SHIELD: "on", PARADISEMODERN_API_KEY: "site-key" });
    let sent: Record<string, unknown> = {};
    setParadiseFetchForTests(async (url, init) => {
      expect(url).toBe("https://paradisemodern.com/api/shield/assess");
      sent = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify({ allow: false, event_id: 9 }), { status: 200 });
    });
    const token = await assessWithShield({ slug: "contact", values: VALUES, fields: FIELDS, request });
    expect(openScreening(token, "contact", VALUES)).toBe("blocked");
    expect(sent).toEqual({
      form_id: "freeholder:contact",
      client_ip: "198.51.100.7",
      user_agent: "Mozilla/5.0",
      submission: { name: "Ada Lovelace", message: VALUES.message },
    });
    expect(JSON.stringify(sent)).not.toContain("ada@example.test");
  });

  it("prefers the proxy-verified address", async () => {
    environment({ PARADISEMODERN_SHIELD: "on", PARADISEMODERN_API_KEY: "site-key" });
    let clientIp: unknown;
    setParadiseFetchForTests(async (_url, init) => {
      clientIp = (JSON.parse(init.body as string) as { client_ip: string }).client_ip;
      return new Response(JSON.stringify({ allow: true }), { status: 200 });
    });
    await assessWithShield({
      slug: "contact",
      values: VALUES,
      fields: FIELDS,
      request: { ...request, trustedIp: "203.0.113.1" },
    });
    expect(clientIp).toBe("203.0.113.1");
  });

  it("seals unavailable when PM is down, disabled for the site, or no address is known", async () => {
    environment({ PARADISEMODERN_SHIELD: "on", PARADISEMODERN_API_KEY: "site-key" });
    setParadiseFetchForTests(async () => { throw new TypeError("fetch failed"); });
    expect(openScreening(await assessWithShield({ slug: "c", values: VALUES, fields: FIELDS, request }), "c", VALUES)).toBe("unavailable");
    setParadiseFetchForTests(async () => new Response(JSON.stringify({ error: "shield_not_enabled" }), { status: 503 }));
    expect(openScreening(await assessWithShield({ slug: "c", values: VALUES, fields: FIELDS, request }), "c", VALUES)).toBe("unavailable");
    let called = false;
    setParadiseFetchForTests(async () => { called = true; return new Response("{}"); });
    expect(openScreening(await assessWithShield({ slug: "c", values: VALUES, fields: FIELDS, request: {} }), "c", VALUES)).toBe("unavailable");
    expect(called).toBe(false);
  });
});

describe("lead capture", () => {
  it("maps an accepted submission onto PM's lead fields", () => {
    environment({ APP_URL: "https://auroracoast.test" });
    expect(
      leadBody(
        { slug: "contact", fields: FIELDS },
        { id: "sub-1", data: VALUES, sourceUrl: "/contact" },
      ),
    ).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.test",
      phone: "+1 250 555 0100",
      message: VALUES.message,
      source: "form:contact",
      externalId: "sub-1",
      fields: {
        Name: "Ada Lovelace",
        Email: "ada@example.test",
        Phone: "+1 250 555 0100",
        "How can we help?": VALUES.message,
      },
      referer: "https://auroracoast.test/contact",
    });
  });

  it("is a no-op unless lead capture is switched on", async () => {
    environment({ PARADISEMODERN_LEADS: undefined, PARADISEMODERN_API_KEY: "site-key" });
    let called = false;
    setParadiseFetchForTests(async () => { called = true; return new Response("{}"); });
    await forwardLead({ submissionId: "00000000-0000-4000-8000-000000000009" });
    expect(called).toBe(false);
  });
});
