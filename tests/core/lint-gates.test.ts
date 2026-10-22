// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.10: the boundary rules in eslint.config.mjs are gates, so they get the
// same proof as any other gate — a fixture that must fail, and the one
// deliberate exception that must pass. Fixture text is linted under the path
// of a real file (the type-aware parser only knows project files), so
// flat-config file globs resolve exactly as `pnpm lint` resolves them.
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });

async function restricted(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  if (result?.messages.some((m) => m.fatal)) throw new Error(JSON.stringify(result.messages));
  return (result?.messages ?? [])
    .filter((message) => message.ruleId?.startsWith("no-restricted"))
    .map((message) => message.message);
}

const HEADER = "// Copyright (C) 2026 Tony Aly\n// SPDX-License-Identifier: Apache-2.0\n";

describe("contact creation gate", { timeout: 120_000 }, () => {
  const fixture = `${HEADER}import { createContact } from "@/core/contacts/service";
import { getService } from "@/core/service";
export const a = createContact;
export const b = getService("contacts.create");
`;

  it("refuses contacts.create on a public app surface", async () => {
    const messages = await restricted("app/(public)/assessment-actions.ts", fixture);
    expect(messages.filter((m) => m.includes("contacts.resolve"))).toHaveLength(2);
  });

  it("keeps the owner's add-contact action as the one exception", async () => {
    const messages = await restricted("app/(admin)/actions.ts", fixture);
    expect(messages.filter((m) => m.includes("contacts.resolve"))).toEqual([]);
  });
});

describe("SVG colour gate", { timeout: 120_000 }, () => {
  it("refuses hex fill/stroke in JSX and in assembled markup", async () => {
    const messages = await restricted(
      "src/ui/SkipLink.tsx",
      `${HEADER}export const markup = \`<rect fill="#ffffff"/>\`;
export const other = '<path stroke="rgb(0 0 0)"/>';
export function Icon() {
  return <svg><path fill="#16181d" /><path stroke={"#000"} /><path fill="currentColor" /></svg>;
}
`,
    );
    expect(messages.filter((m) => m.includes("SVG fill/stroke"))).toHaveLength(4);
  });
});
