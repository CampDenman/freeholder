// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Read-only acceptance: export imports.wordpressVerificationPlan to JSON, then
// compare the source crawl and the destination over real HTTP before cutover.
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parse } from "parse5";

export function htmlMetadata(html) {
  const result = { title: "", canonical: "", description: "", robots: "", ogTitle: "", ogDescription: "", ogImage: "", hreflang: {} };
  const text = node => node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(text).join("");
  const visit = node => {
    const attrs = Object.fromEntries((node.attrs ?? []).map(attr => [attr.name, attr.value]));
    if (node.tagName === "title") result.title = text(node).trim();
    if (node.tagName === "link" && attrs.rel?.split(/\s+/).includes("canonical")) result.canonical = attrs.href ?? "";
    if (node.tagName === "link" && attrs.rel?.split(/\s+/).includes("alternate") && attrs.hreflang) result.hreflang[attrs.hreflang] = attrs.href ?? "";
    if (node.tagName === "meta") {
      const key = { description: "description", robots: "robots", "og:title": "ogTitle", "og:description": "ogDescription", "og:image": "ogImage" }[attrs.name ?? attrs.property];
      if (key) result[key] = attrs.content ?? "";
    }
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(parse(html)); return result;
}

async function read(url) {
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15000), headers: { "user-agent": "Freeholder-Migration-Verification/1.0" } });
  return { status: response.status, location: response.headers.get("location"), type: response.headers.get("content-type") ?? "", body: await response.text() };
}

export async function verifyMigration(plan, destinationOrigin) {
  const origin = new URL(destinationOrigin);
  if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password) throw new Error("Use an HTTP(S) destination without credentials.");
  const source = new URL(plan.sourceOrigin);
  if (!["http:", "https:"].includes(source.protocol) || source.username || source.password) throw new Error("Use an HTTP(S) source without credentials.");
  const sourceMap = new Map(plan.checks.map(check => { const url = new URL(check.sourceUrl); return [`${url.pathname.replace(/\/+$/, "") || "/"}${url.search}`, check.destinationPath]; }));
  const normalize = value => {
    const parsed = new URL(value, origin);
    if (parsed.origin === source.origin) {
      const mapped = sourceMap.get(`${parsed.pathname.replace(/\/+$/, "") || "/"}${parsed.search}`);
      if (mapped) { const destination = new URL(mapped, origin); parsed.pathname = destination.pathname; parsed.search = destination.search; }
      parsed.host = origin.host; parsed.protocol = origin.protocol;
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    parsed.searchParams.sort(); return parsed.href;
  };
  const rows = [];
  for (const check of plan.checks) {
    const request = new URL(check.requestPath, origin);
    const wanted = new URL(check.destinationPath, origin);
    if (request.origin !== origin.origin || wanted.origin !== origin.origin) throw new Error("A destination path escaped the configured origin.");
    const errors = [], warnings = [];
    let response, sourceMeta, destinationMeta;
    try {
      response = await read(request);
      if (check.redirect && response.status !== 301) errors.push(`Expected one 301, received ${response.status}.`);
      if (response.status >= 300 && response.status < 400) {
        const target = new URL(response.location ?? "", request);
        if (normalize(target) !== normalize(wanted)) errors.push(`Unexpected redirect target: ${target.href}`);
        if (target.origin !== origin.origin) throw new Error("Redirect escaped the destination origin.");
        response = await read(target);
      }
      if (response.status !== 200) errors.push(`Final response was ${response.status}; required 200 after at most one redirect.`);
      if (response.type.includes("text/html")) {
        destinationMeta = htmlMetadata(response.body);
        const expected = check.expected ?? {};
        for (const key of ["title", "description", "ogTitle", "ogDescription"]) if (expected[key] && destinationMeta[key] !== expected[key]) errors.push(`${key} differs from the imported value.`);
        const canonical = expected.canonical ? new URL(expected.canonical, origin) : wanted;
        if (!destinationMeta.canonical || normalize(destinationMeta.canonical) !== normalize(canonical)) errors.push("Canonical differs from the intended destination.");
        if (expected.noindex && !/\bnoindex\b/i.test(destinationMeta.robots)) errors.push("Imported noindex was lost.");
        if (expected.nofollow && !/\bnofollow\b/i.test(destinationMeta.robots)) errors.push("Imported nofollow was lost.");
        if (!check.redirect) {
          try {
            if (new URL(check.sourceUrl).origin !== source.origin) throw new Error("Source URL is outside the configured source origin.");
            let old = await read(check.sourceUrl);
            if (old.status >= 300 && old.status < 400 && old.location) {
              const next = new URL(old.location, check.sourceUrl);
              if (next.origin === source.origin) old = await read(next);
            }
            if (old.status !== 200 || !old.type.includes("text/html")) warnings.push(`Source metadata unavailable (${old.status}).`);
            else {
              sourceMeta = htmlMetadata(old.body);
              for (const key of ["title", "description", "ogTitle", "ogDescription"]) if (sourceMeta[key] && sourceMeta[key] !== destinationMeta[key]) errors.push(`${key} changed from the rendered source.`);
              if (sourceMeta.canonical && normalize(new URL(sourceMeta.canonical, source)) !== normalize(destinationMeta.canonical)) errors.push("Canonical changed from the rendered source.");
              for (const directive of ["noindex", "nofollow"]) if (new RegExp(`\\b${directive}\\b`, "i").test(sourceMeta.robots) !== new RegExp(`\\b${directive}\\b`, "i").test(destinationMeta.robots)) errors.push(`${directive} changed from the source.`);
              for (const [locale, href] of Object.entries(sourceMeta.hreflang)) if (!destinationMeta.hreflang[locale] || normalize(href) !== normalize(destinationMeta.hreflang[locale])) errors.push(`hreflang ${locale} changed or disappeared.`);
              if (sourceMeta.ogImage && !destinationMeta.ogImage) errors.push("Open Graph image disappeared.");
            }
          } catch (error) { warnings.push(`Source comparison unavailable: ${error.message}`); }
        }
      }
    } catch (error) { errors.push(error.message); }
    rows.push({ ...check, errors, warnings, sourceMeta, destinationMeta });
  }
  return { verifiedAt: new Date().toISOString(), destinationOrigin: origin.origin, status: plan.status, accepted: plan.status === "published" && !plan.warnings.length && rows.every(row => !row.errors.length && !row.warnings.length), unresolved: plan.warnings, rows };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [planPath, destination, outputPath] = process.argv.slice(2);
  if (!planPath || !destination || !outputPath) throw new Error("Usage: node scripts/verify-wordpress-migration.mjs PLAN.json https://destination.example REPORT.json");
  const report = await verifyMigration(JSON.parse(await readFile(planPath, "utf8")), destination);
  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`${report.rows.length} URL checks; ${report.rows.filter(row => row.errors.length).length} failed; ${report.unresolved.length} unresolved source features. Report: ${outputPath}`);
  if (!report.accepted) process.exitCode = 1;
}
