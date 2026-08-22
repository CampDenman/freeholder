// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The autofill gate (MASTER.md §15's machine gates, §36's forms).
//
// This exists because of a bug class that is invisible to the way we test and
// unavoidable given the way people actually behave.
//
// React tracks an input's value in its own state. A browser's autofill sets
// `input.value` directly, and that does **not** fire the event React listens
// for — so iOS Safari's contact card, 1Password, Bitwarden, Chrome and
// Keychain can all fill a form that React still believes is empty. A submit
// button written `disabled={busy || !form.email}` then stays grey. The person
// sees their name and address sitting in the boxes, taps the button, and
// nothing happens. No error, because no code ran.
//
// Typing works perfectly. Every hand test, every test that types, the whole
// development loop — all pass. The bug exists only when the *browser* fills
// the form, which on a phone is the normal path rather than an edge case.
//
// So the rule is mechanical, and this is the machine that enforces it:
//
//   **Never disable a submit control because an autofillable field looks
//   empty.** `disabled={busy}` — in-flight state only, never field contents.
//
// A field nothing autofills is fine to gate on: no browser fills in a listing
// title. The list below is what browsers and password managers actually reach
// for.
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { AUTOFILL_TERMS, HONEYPOT_FIELD } from "@/modules/forms/antispam";

const ROOT = join(process.cwd());
const SCANNED = ["app", "src"];

/** What a browser or password manager fills without being asked. */
const AUTOFILLABLE = [
  "name",
  "firstname",
  "lastname",
  "givenname",
  "familyname",
  "fullname",
  "email",
  "phone",
  "tel",
  "mobile",
  "address",
  "street",
  "city",
  "postcode",
  "postalcode",
  "zip",
  "country",
  "organization",
  "organisation",
  "company",
  "username",
  "password",
];

async function tsxFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await tsxFiles(path)));
    else if (entry.name.endsWith(".tsx")) found.push(path);
  }
  return found;
}

/**
 * Every `disabled={...}` expression in a source file.
 *
 * Brace-counting rather than a regex for the whole thing, because a real
 * expression contains braces — `disabled={busy || !f.email}` is easy and
 * `disabled={items.some((i) => !i.ok)}` is not.
 */
function disabledExpressions(source: string): string[] {
  const found: string[] = [];
  const marker = /\bdisabled=\{/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(source)) !== null) {
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    while (index < source.length && depth > 0) {
      const character = source[index];
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
      index += 1;
    }
    found.push(source.slice(start, index - 1));
  }
  return found;
}

/**
 * Whether an expression gates on an autofillable field looking empty.
 *
 * Matches the shapes people actually write for "this box is empty": a bare
 * negation, a comparison with the empty string, a zero length, and the
 * trimmed variants of each.
 */
export function gatesOnAutofillableEmptiness(expression: string): string | null {
  const normalised = expression.replace(/\s+/g, "");
  const term = `(?:[A-Za-z_$][\\w$]*\\.)*(${AUTOFILLABLE.join("|")})`;
  const shapes = [
    // !form.email / !email / !form.email?.trim()
    new RegExp(`![A-Za-z_$][\\w$.?]*\\b${term}\\b`, "i"),
    new RegExp(`!${term}\\b`, "i"),
    // email===""  /  email.trim()===''  /  form.email?.trim()===""
    new RegExp(`${term}\\b[\\w$.?()]*===?["'\`]["'\`]`, "i"),
    // email.length===0  /  email.trim().length<1
    new RegExp(`${term}\\b[\\w$.?()]*\\.length(?:===?0|<1)`, "i"),
  ];
  for (const shape of shapes) {
    const hit = shape.exec(normalised);
    if (hit) return hit[0];
  }
  return null;
}

/**
 * Whether this `disabled` sits on something that submits.
 *
 * Checked against the 400 characters before it, which comfortably covers a
 * multi-line JSX opening tag. A `<Button>` with no explicit type submits, so
 * it counts unless it says otherwise.
 */
function isSubmitControl(source: string, position: number): boolean {
  const before = source.slice(Math.max(0, position - 400), position);
  const tag = before.lastIndexOf("<");
  if (tag === -1) return false;
  const opening = before.slice(tag);
  if (/type=["']button["']/.test(opening)) return false;
  return (
    /type=["']submit["']/.test(opening) ||
    /<Button\b/.test(opening) ||
    /<button\b/.test(opening)
  );
}

describe("the autofill gate itself", () => {
  // A guard that cannot fail is not a guard. These fixtures are the exact
  // shapes that shipped in a real product, and the exact shapes that must
  // stay allowed.
  it("flags the expression that actually broke a form", () => {
    expect(gatesOnAutofillableEmptiness("busy || !f.name || !f.email")).toBeTruthy();
    expect(gatesOnAutofillableEmptiness("!form.email")).toBeTruthy();
    expect(gatesOnAutofillableEmptiness("!email")).toBeTruthy();
    expect(gatesOnAutofillableEmptiness("email === ''")).toBeTruthy();
    expect(gatesOnAutofillableEmptiness("state.phone.trim() === \"\"")).toBeTruthy();
    expect(gatesOnAutofillableEmptiness("values.postcode.length === 0")).toBeTruthy();
    expect(gatesOnAutofillableEmptiness("!f.email?.trim()")).toBeTruthy();
  });

  it("leaves in-flight state and non-autofillable fields alone", () => {
    for (const allowed of [
      "busy",
      "pending",
      "saving || deleting",
      "!f.title",
      "!status.configured",
      "!canFulfill || !stepUpValid",
      "!available || generating",
      "index === 0",
      "!category.active",
    ]) {
      expect(
        gatesOnAutofillableEmptiness(allowed),
        `${allowed} must not be flagged`,
      ).toBeNull();
    }
  });

  it("reads a disabled expression that contains braces of its own", () => {
    const source = `<Button disabled={items.some((i) => !i.ok)}>x</Button>`;
    expect(disabledExpressions(source)).toEqual(["items.some((i) => !i.ok)"]);
  });

  it("knows a submit control from a plain button", () => {
    const submit = `<Button type="submit" disabled={busy}>`;
    const plain = `<Button type="button" disabled={busy}>`;
    expect(isSubmitControl(submit, submit.indexOf("disabled"))).toBe(true);
    expect(isSubmitControl(plain, plain.indexOf("disabled"))).toBe(false);
  });
});

describe("no submit control is gated on an autofillable field", () => {
  it("holds across every screen in the repository", async () => {
    const offenders: string[] = [];
    for (const directory of SCANNED) {
      for (const file of await tsxFiles(join(ROOT, directory))) {
        const source = await readFile(file, "utf8");
        const marker = /\bdisabled=\{/g;
        let match: RegExpExecArray | null;
        while ((match = marker.exec(source)) !== null) {
          if (!isSubmitControl(source, match.index)) continue;
          const [expression] = disabledExpressions(
            source.slice(match.index),
          );
          if (!expression) continue;
          const hit = gatesOnAutofillableEmptiness(expression);
          if (hit) {
            const line = source.slice(0, match.index).split("\n").length;
            offenders.push(
              `${relative(ROOT, file)}:${line} — disabled={${expression}} gates on "${hit}"`,
            );
          }
        }
      }
    }

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : [
            "A submit control is disabled because an autofillable field looks empty.",
            "",
            "A browser filling that field does not tell React, so the button stays",
            "grey over a form the person can see is complete. Validate inside the",
            "submit handler and show a message instead; keep `disabled` for",
            "in-flight state only.",
            "",
            ...offenders,
          ].join("\n"),
    ).toEqual([]);
  });
});

describe("the honeypot is not something a browser will fill", () => {
  it("is named for nothing an autofill heuristic reaches for", () => {
    // `website_url` was the original name and the original bug: every
    // password manager recognises "url", and a person accepting their own
    // contact card would have had the trap filled for them.
    const name = HONEYPOT_FIELD.toLowerCase();
    const matched = AUTOFILL_TERMS.filter((term) => name.includes(term));
    expect(
      matched,
      `The honeypot is called "${HONEYPOT_FIELD}", which contains ${matched.join(", ")} — a filler will complete it and frame a real visitor.`,
    ).toEqual([]);
  });

  it("carries the opt-outs the password managers actually read", async () => {
    const markup = await readFile(
      join(ROOT, "src/modules/forms/block.tsx"),
      "utf8",
    );
    const field = markup.slice(markup.indexOf("name={HONEYPOT_FIELD}"));
    const input = field.slice(0, field.indexOf("/>"));
    // `autoComplete="off"` is advisory and iOS ignores it, so each of these
    // is load-bearing rather than belt-and-braces decoration.
    for (const attribute of [
      "data-1p-ignore",
      'data-lpignore="true"',
      'data-form-type="other"',
    ]) {
      expect(input, `the honeypot needs ${attribute}`).toContain(attribute);
    }
  });

  it("is hidden from sight and from assistive technology, and out of the tab order", async () => {
    const markup = await readFile(
      join(ROOT, "src/modules/forms/block.tsx"),
      "utf8",
    );
    const block = markup.slice(
      markup.indexOf('<div className="hidden" aria-hidden="true">'),
    );
    const container = block.slice(0, block.indexOf("</div>"));
    expect(container).toContain("tabIndex={-1}");
    expect(block.indexOf('aria-hidden="true"')).toBeLessThan(
      block.indexOf("name={HONEYPOT_FIELD}"),
    );
  });
});
