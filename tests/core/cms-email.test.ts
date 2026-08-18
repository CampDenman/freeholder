// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Email-safe rendering and preview (C2.19).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fillSlots, renderEmailHtml, renderEmailText } from "@/modules/cms/email-render";
import { paletteFor, parseBlockTree } from "@/modules/cms/blocks/registry";
import { ensureTemplates, previewEmail } from "@/modules/cms/service";
import { updateBusiness } from "@/core/settings/service";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe("email palette and renderer", () => {
  it("offers only email-safe blocks", () => {
    const types = paletteFor("email").map((entry) => entry.type);
    expect(types).toContain("heading");
    expect(types).toContain("variable");
    expect(types).not.toContain("faq");
    expect(types).not.toContain("paywall");
    expect(types).not.toContain("nav");
  });

  it("renders tables and fills locked slots", () => {
    const tree = parseBlockTree(
      [
        { id: "h", type: "heading", props: { text: "Hello {{contact.first_name}}", level: 1 } },
        { id: "v", type: "variable", props: { slot: "invoice.total" } },
      ],
      "email",
    );
    const vars = {
      "contact.first_name": "Alex",
      "invoice.total": "$40.00",
    };
    const headingText = tree[0]?.props.text;
    expect(typeof headingText === "string" ? fillSlots(headingText, vars) : "").toBe("Hello Alex");
    const html = renderEmailHtml(tree, vars);
    expect(html).toContain("<table role=\"presentation\"");
    expect(html).toContain("Hello Alex");
    expect(html).toContain("$40.00");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("{{contact.first_name}}");
    expect(fillSlots("Hi {{ contact.first_name }}", { "contact.first_name": "Sam" })).toBe(
      "Hi Sam",
    );
    expect(renderEmailText(tree, { "contact.first_name": "Alex", "invoice.total": "$40.00" })).toContain(
      "Hello Alex",
    );
  });
});

describe.runIf(hasDatabase)("email template preview", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine, 30_000);
  afterAll(closeDb);

  it("previews the seeded transactional template", async () => {
    await updateBusiness.call(
      {
        name: "Studio",
        country: "CA",
        baseCurrency: "CAD",
        timezone: "America/Vancouver",
        schemaType: "Photographer",
      },
      OWNER,
    );
    await ensureTemplates.call({}, OWNER);
    const preview = await previewEmail.call({ key: "email.transactional" }, OWNER);
    expect(preview.html).toContain("<table");
    expect(preview.text.length).toBeGreaterThan(0);
    expect(preview.subject.length).toBeGreaterThan(0);
  });
});
