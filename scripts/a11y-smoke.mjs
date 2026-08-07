// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The accessibility smoke test (MASTER.md §15.7).
//
// "Smoke" is the honest word for it. axe-core against a parsed document finds
// the structural failures — an unlabelled control, a broken heading order, a
// missing landmark, a link with no accessible name — and cannot find anything
// that needs layout or interaction: focus order, visible focus rings, whether
// a menu traps a keyboard, whether text reflows at 320px.
//
// Colour contrast is the one axe would normally cover here and cannot without
// a rendering engine. It is not left unchecked: tests/core/tokens.test.ts
// enforces WCAG AA on every semantic token pairing in *both* schemes, which is
// where the contrast decisions actually live (§32 forbids literal colours).
//
// Usage: node scripts/a11y-smoke.mjs <base-url> [path...]
import { JSDOM } from "jsdom";
import axe from "axe-core";

/**
 * Rules that mean something without layout.
 *
 * Deliberately a list rather than "everything minus contrast": a gate that
 * reports rules it cannot evaluate produces "incomplete" noise, and a noisy
 * gate is one people learn to skim.
 */
const RULES = [
  "area-alt",
  "aria-allowed-attr",
  "aria-hidden-body",
  "aria-hidden-focus",
  "aria-required-attr",
  "aria-required-children",
  "aria-required-parent",
  "aria-roles",
  "aria-valid-attr",
  "aria-valid-attr-value",
  "button-name",
  "document-title",
  "duplicate-id-aria",
  "empty-heading",
  "form-field-multiple-labels",
  "frame-title",
  "heading-order",
  "html-has-lang",
  "html-lang-valid",
  "image-alt",
  "input-button-name",
  "input-image-alt",
  "label",
  "landmark-one-main",
  "link-name",
  "list",
  "listitem",
  "meta-viewport",
  "nested-interactive",
  // "page-has-heading-one" is absent on purpose: axe can only report it as
  // *incomplete* without layout, so including it would add a rule that
  // silently evaluates to nothing. The SEO gate asserts exactly one <h1> per
  // page against the same markup, which is the same guarantee with teeth.
  "region",
  "select-name",
  "td-headers-attr",
  "th-has-data-cells",
  "valid-lang",
];

export async function auditHtml(html, url) {
  // axe binds to the globals of the window it runs *inside*, so it is injected
  // into the jsdom window rather than imported beside it. That means enabling
  // scripting — and the page's own scripts must go first, because running
  // React's hydration bundle inside jsdom proves nothing about accessibility
  // and fails in ways that have nothing to do with the page.
  const markup = html
    .replace(/<script\b(?![^>]*type="application\/ld\+json")[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/>/gi, "");

  const dom = new JSDOM(markup, {
    url,
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });

  try {
    dom.window.eval(axe.source);
    const results = await dom.window.axe.run(dom.window.document, {
      runOnly: { type: "rule", values: RULES },
      resultTypes: ["violations"],
      // Layout-dependent checks would report "incomplete" here for reasons
      // that say nothing about the page.
      rules: { "color-contrast": { enabled: false } },
    });
    // Incompletes are returned alongside violations rather than dropped. A
    // rule axe cannot decide here is not a rule that passed, and a gate that
    // reports only violations quietly turns "could not check" into "fine".
    return {
      violations: results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.map((node) => node.html.slice(0, 120)),
      })),
      undecided: results.incomplete.map((result) => result.id),
    };
  } finally {
    dom.window.close();
  }
}

async function main() {
  const base = process.argv[2] ?? "http://localhost:3000";
  // The templates, not every page: a smoke test over one instance of each
  // layout. Add a path here when a genuinely different template ships.
  const paths = process.argv.slice(3);
  const targets = paths.length > 0 ? paths : ["/", "/services", "/services/weddings", "/contact"];

  let failed = 0;
  const allUndecided = new Set();
  for (const path of targets) {
    const url = new URL(path, base).toString();
    const response = await fetch(url);
    if (response.status !== 200) {
      console.error(`a11y smoke: ${path} answered ${response.status}`);
      failed += 1;
      continue;
    }
    const { violations, undecided } = await auditHtml(await response.text(), url);
    for (const id of undecided) allUndecided.add(id);
    if (violations.length === 0) {
      console.log(`  ok  ${path}`);
      continue;
    }
    failed += 1;
    console.error(`  FAIL ${path}`);
    for (const violation of violations) {
      console.error(`    ${violation.id} (${violation.impact}): ${violation.help}`);
      for (const node of violation.nodes) console.error(`      ${node}`);
    }
  }

  if (failed > 0) {
    console.error(
      `\nA11y smoke (MASTER.md §15.7): ${failed} template(s) with violations.\n` +
        "These are the structural failures a parser can see. Focus order, focus\n" +
        "visibility and reflow still need a human and a keyboard.",
    );
    process.exit(1);
  }
  if (allUndecided.size > 0) {
    // Said out loud rather than swallowed. These are rules that ran and could
    // not reach a verdict without a browser — exactly the ones a reader would
    // otherwise assume had passed.
    console.log(`\n  undecided without a browser: ${[...allUndecided].sort().join(", ")}`);
  }
  console.log(`\nA11y smoke: ${targets.length} templates clean on the static rules.`);
}

if (process.argv[1] && process.argv[1].endsWith("a11y-smoke.mjs")) {
  await main();
}
