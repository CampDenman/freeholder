// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Read-only acceptance: export imports.wordpressVerificationPlan to JSON, then
// compare the source crawl and the destination over real HTTP before cutover.
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { parse } from "parse5";
import { z } from "zod";

const reservedFeedWarning = "WordPress /feed is Freeholder's member feed; WordPress feed aliases use /feeds/blog.xml.";
const feedAliases = ["/?feed=rss2", "/?feed=atom", "/?feed=rss"];
const atomNamespace = "http://www.w3.org/2005/Atom";
const maxAtomBytes = 20 * 1024 * 1024;
const atomTimestamp = z.iso.datetime({ offset: true });
const atomParser = new XMLParser({
  preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "", parseTagValue: false,
  ignoreDeclaration: true, ignorePiTags: true, processEntities: false, maxNestedTags: 64,
});
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const feedDecisionSchema = z.strictObject({
  schema: z.literal("freeholder/wordpress-feed-decision/v1"),
  decision: z.literal("keep-freeholder-member-feed"),
  reference: z.string().min(1).max(256).refine(value => value === value.trim()),
  referenceSha256: sha256,
  sourceOrigin: z.string().min(1).max(2048),
  destinationOrigin: z.string().min(1).max(2048),
  runId: z.uuid(),
  generation: z.uuid(),
  planDigest: sha256,
});

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

function xmlElements(nodes, inherited = new Map()) {
  return nodes.flatMap(node => {
    const tag = Object.keys(node).find(key => !key.startsWith("#") && Array.isArray(node[key]));
    if (!tag) return [];
    const namespaces = new Map(inherited);
    for (const [attribute, value] of Object.entries(node[":@"] ?? {})) {
      if (attribute === "xmlns") namespaces.set("", value);
      if (attribute.startsWith("xmlns:")) namespaces.set(attribute.slice(6), value);
    }
    const parts = tag.split(":");
    if (parts.length > 2 || parts.some(part => !part)) throw new Error("Invalid XML element name.");
    const [prefix, local] = parts.length === 2 ? parts : ["", tag];
    return [{ local, namespace: namespaces.get(prefix), namespaces, children: node[tag] }];
  });
}

function xmlText(nodes) {
  return nodes.map(node => {
    if (typeof node["#text"] === "string") return node["#text"];
    return xmlText(Object.values(node).find(Array.isArray) ?? []);
  }).join("");
}

function validateAtomMetadata(element) {
  const fields = xmlElements(element.children, element.namespaces).filter(field => field.namespace === atomNamespace);
  for (const name of ["id", "title", "updated"]) {
    const matches = fields.filter(field => field.local === name);
    if (matches.length !== 1) throw new Error(`Atom ${element.local} requires exactly one ${name} element.`);
    const field = matches[0];
    const value = xmlText(field.children).trim();
    if (!value || (name !== "title" && xmlElements(field.children, field.namespaces).length)) {
      throw new Error(`Atom ${element.local} has invalid ${name} content.`);
    }
    if (name === "id" && !/^[a-z][a-z0-9+.-]*:[^\s]+$/i.test(value)) throw new Error(`Atom ${element.local} has an invalid ID.`);
    if (name === "updated" && !atomTimestamp.safeParse(value.toUpperCase()).success) {
      throw new Error(`Atom ${element.local} has an invalid updated timestamp.`);
    }
  }
}

function validateAtomFeed(body) {
  const malformed = "The final response must contain a well-formed Atom XML feed.";
  if (/<!DOCTYPE|<!ENTITY/i.test(body) || XMLValidator.validate(body) !== true) throw new Error(malformed);
  let elements;
  try { elements = xmlElements(atomParser.parse(body)); }
  catch { throw new Error(malformed); }
  const [feed] = elements;
  if (elements.length !== 1 || feed.local !== "feed" || feed.namespace !== atomNamespace) throw new Error(malformed);
  validateAtomMetadata(feed);
  for (const entry of xmlElements(feed.children, feed.namespaces)) {
    if (entry.local === "entry" && entry.namespace === atomNamespace) validateAtomMetadata(entry);
  }
}

async function readAtomBody(response) {
  if (response.status !== 200) {
    await response.body?.cancel();
    return "";
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body ?? []) {
    length += chunk.byteLength;
    if (length > maxAtomBytes) throw new Error("The Atom response exceeds the 20 MiB verification limit.");
    chunks.push(chunk);
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { throw new Error("The Atom response must contain valid UTF-8."); }
}

async function read(url, expectsAtom = false) {
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15000), headers: { "user-agent": "Freeholder-Migration-Verification/1.0" } });
  return { status: response.status, location: response.headers.get("location"), type: response.headers.get("content-type") ?? "", body: expectsAtom ? await readAtomBody(response) : await response.text() };
}

function assembleVerificationWindows(windows) {
  const first = windows[0];
  const identity = first?.window;
  if (!identity?.runId || !identity.generation || !/^[a-f0-9]{64}$/.test(identity.planDigest)) {
    throw new Error("The first verification window needs an import run, generation and plan digest.");
  }
  const { sourceOrigin, status } = first;
  const checks = [];
  const warnings = new Set();
  let cursor = -1;
  for (const [index, page] of windows.entries()) {
    const { window, nextOrdinal } = page;
    if (page.sourceOrigin !== sourceOrigin || page.status !== status || window?.runId !== identity.runId ||
        window.generation !== identity.generation || window.planDigest !== identity.planDigest) {
      throw new Error(`Verification window ${index + 1} belongs to a different import, plan or publication state.`);
    }
    const final = index === windows.length - 1;
    if (window.afterOrdinal !== cursor || (final ? nextOrdinal !== null : !Number.isSafeInteger(nextOrdinal) || nextOrdinal <= cursor)) {
      throw new Error(`Verification window ${index + 1} has a missing or out-of-order cursor.`);
    }
    for (const check of page.checks) checks.push(check);
    for (const warning of page.warnings) warnings.add(warning);
    cursor = nextOrdinal;
  }
  return {
    sourceOrigin, status, checks, warnings: [...warnings],
    windowSequence: { runId: identity.runId, generation: identity.generation, planDigest: identity.planDigest, count: windows.length },
  };
}

function bindFeedDecision(receipt, plan, destinationOrigin) {
  const decision = feedDecisionSchema.parse(receipt);
  const identity = plan.windowSequence;
  if (plan.status !== "published" || !identity || decision.runId !== identity.runId ||
      decision.generation !== identity.generation || decision.planDigest !== identity.planDigest ||
      decision.sourceOrigin !== plan.sourceOrigin || decision.destinationOrigin !== destinationOrigin) {
    throw new Error("The reserved feed decision must match the complete published import and its exact source and destination.");
  }
  if (!plan.warnings.includes(reservedFeedWarning)) throw new Error("The published import did not report the reserved feed collision named by this decision.");
  return decision;
}

export async function verifyMigration(planOrWindows, destinationOrigin, { feedDecision } = {}) {
  const completeWindows = Array.isArray(planOrWindows);
  if (feedDecision !== undefined && !completeWindows) throw new Error("The reserved feed decision requires all original verification windows.");
  const plan = completeWindows ? assembleVerificationWindows(planOrWindows) : planOrWindows;
  const origin = new URL(destinationOrigin);
  if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password) throw new Error("Use an HTTP(S) destination without credentials.");
  const source = new URL(plan.sourceOrigin);
  if (!["http:", "https:"].includes(source.protocol) || source.username || source.password) throw new Error("Use an HTTP(S) source without credentials.");
  const decision = feedDecision === undefined ? undefined : bindFeedDecision(feedDecision, plan, origin.origin);
  const sourceMap = new Map();
  for (const check of plan.checks) {
    const url = new URL(check.sourceUrl);
    const path = `${url.pathname.replace(/\/+$/, "") || "/"}${url.search}`;
    // A feed alias may share the source URL of an imported homepage. The
    // imported page supplies the canonical mapping for that URL.
    const existing = sourceMap.get(path);
    if (check.redirect && existing && !existing.redirect) continue;
    sourceMap.set(path, check);
  }
  const normalize = value => {
    const parsed = new URL(value, origin);
    if (parsed.origin === source.origin) {
      const mapped = sourceMap.get(`${parsed.pathname.replace(/\/+$/, "") || "/"}${parsed.search}`)?.destinationPath;
      if (mapped) { const destination = new URL(mapped, origin); parsed.pathname = destination.pathname; parsed.search = destination.search; }
      parsed.host = origin.host; parsed.protocol = origin.protocol;
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    parsed.searchParams.sort(); return parsed.href;
  };
  let unresolved = [...plan.warnings];
  if (plan.checks.length === 0) unresolved.push("The plan contains no public URL checks.");
  // Graph plans include the cursor even in their final window. A standalone
  // window covers only its own entries.
  if (plan.window !== undefined || plan.nextOrdinal !== undefined) unresolved.push("Migration-wide acceptance requires all verification windows.");
  const rows = [];
  for (const check of plan.checks) {
    const request = new URL(check.requestPath, origin);
    const wanted = new URL(check.destinationPath, origin);
    if (request.origin !== origin.origin || wanted.origin !== origin.origin) throw new Error("A destination path escaped the configured origin.");
    const expectsAtom = wanted.pathname === "/feeds/blog.xml";
    const errors = [], warnings = [];
    let response, sourceMeta, destinationMeta;
    try {
      response = await read(request, expectsAtom);
      if (check.redirect || response.status !== 200) {
        if (response.status !== 301) {
          throw new Error(`Expected ${check.redirect ? "one 301" : "200 or one 301"}, received ${response.status}.`);
        }
        if (!response.location?.trim()) throw new Error("A 301 response is missing its Location.");
        const target = new URL(response.location, request);
        if (target.origin !== origin.origin) throw new Error("Redirect escaped the destination origin.");
        if (normalize(target) !== normalize(wanted)) throw new Error(`Unexpected 301 redirect target: ${target.href}`);
        response = await read(target, expectsAtom);
      }
      if (response.status !== 200) throw new Error(`Final response was ${response.status}; required 200 after at most one redirect.`);
      const expectedType = expectsAtom ? "application/atom+xml" : "text/html";
      if (response.type.split(";", 1)[0]?.trim().toLowerCase() !== expectedType) {
        throw new Error(`Expected ${expectedType} from the final route, received ${response.type || "no Content-Type"}.`);
      }
      if (expectsAtom) validateAtomFeed(response.body);
      else {
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
  let feedDisposition;
  if (decision) {
    const verifiedAliases = feedAliases.filter(path => {
      const matches = rows.filter(row => row.requestPath === path);
      if (matches.length !== 1) return false;
      const row = matches[0];
      return row.sourceUrl === plan.sourceOrigin && row.redirect === true && row.destinationPath === "/feeds/blog.xml" &&
        !row.errors.length && !row.warnings.length;
    });
    const applied = verifiedAliases.length === feedAliases.length;
    if (applied) unresolved = unresolved.filter(warning => warning !== reservedFeedWarning);
    feedDisposition = { receipt: decision, status: applied ? "applied" : "unverified", warning: reservedFeedWarning, verifiedAliases };
  }
  return {
    verifiedAt: new Date().toISOString(),
    destinationOrigin: origin.origin,
    status: plan.status,
    accepted: plan.status === "published" && !unresolved.length && rows.every(row => !row.errors.length && !row.warnings.length),
    unresolved, rows,
    ...(plan.windowSequence ? { windowSequence: plan.windowSequence } : {}),
    ...(feedDisposition ? { feedDisposition } : {}),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [planPath, destination, outputPath, decisionPath] = process.argv.slice(2);
  if (!planPath || !destination || !outputPath) throw new Error("Usage: node scripts/verify-wordpress-migration.mjs PLAN.json https://destination.example REPORT.json [FEED-DECISION.json]");
  const feedDecision = decisionPath === undefined ? undefined : JSON.parse(await readFile(decisionPath, "utf8"));
  const report = await verifyMigration(JSON.parse(await readFile(planPath, "utf8")), destination, { feedDecision });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  console.log(`${report.rows.length} URL checks; ${report.rows.filter(row => row.errors.length).length} failed; ${report.unresolved.length} unresolved source features. Report: ${outputPath}`);
  if (!report.accepted) process.exitCode = 1;
}
