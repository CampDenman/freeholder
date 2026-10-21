#!/usr/bin/env node
// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Living screenshots (MASTER.md C3.29): publish a capture to an instance's own
// media library and rebuild its public gallery pages, so the gallery on
// freeholder.ai is served by the product it pictures.
//
// Input is the capture directory the screenshots workflow uploads as its
// artifact (manifest.json plus the WebP files). The instance is configured
// with FREEHOLDER_GALLERY_URL and a scoped agent key in
// FREEHOLDER_GALLERY_TOKEN (`Authorization: Bearer fh_live_…`). The key needs
// media.* and cms.* scopes and nothing else.
//
// Every run converges: an image already in the library (same filename and
// SHA-256) is reused, the pages are rebuilt from the manifest, and any
// gallery page the manifest no longer needs is unpublished. Nothing is
// printed but counts and page paths; the token never appears in output.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Same grouping as scripts/screenshots-index.mjs, so both galleries agree. */
const GROUPS = [
  ["Customer journey", "journey", (s) => s.slug.startsWith("journey-")],
  ["Public site", "public", (s) => !s.slug.startsWith("journey-") && s.role === "public"],
  ["Customer portal", "portal", (s) => !s.slug.startsWith("journey-") && s.role === "customer"],
  ["Admin", "admin", (s) => s.role === "owner"],
];

/** A page's image budget is 24 blocks (C2.22), and a gallery block holds 24
 * items. One gallery block per shot (its four variants) keeps a shot's sizes
 * together, so the binding constraint is 24 shots per page. */
const SHOTS_PER_PAGE = 24;

const VARIANT_LABEL = {
  "desktop--light": "Desktop, light",
  "desktop--dark": "Desktop, dark",
  "mobile--light": "Mobile, light",
  "mobile--dark": "Mobile, dark",
};

function variantOf(file) {
  return VARIANT_LABEL[file.replace(/\.webp$/, "").split("--").slice(-2).join("--")] ?? file;
}

/**
 * The page set for a capture, pure so the shape is testable without an
 * instance. `assetFor` maps a capture filename to its media asset id.
 */
export function buildPages(shots, assetFor, meta) {
  const pages = [];
  const indexBlocks = [
    { id: "h1", type: "heading", props: { text: "Screenshots", level: 1 } },
    {
      id: "intro",
      type: "text",
      props: {
        body: `Every screen of the current release, captured ${meta.capturedAt ?? "recently"}` +
          (meta.commit ? ` from commit ${String(meta.commit).slice(0, 12)}` : "") +
          ". Each screen is shown on desktop and mobile, in light and dark.",
      },
    },
  ];
  const groups = GROUPS.map(([label, key, match]) => ({
    label,
    key,
    shots: shots.filter(match),
  })).filter((group) => group.shots.length > 0);

  for (const group of groups) {
    const chunks = [];
    for (let i = 0; i < group.shots.length; i += SHOTS_PER_PAGE) {
      chunks.push(group.shots.slice(i, i + SHOTS_PER_PAGE));
    }
    group.pages = chunks.map((chunk, n) => {
      const title = chunks.length === 1 ? `${group.label} screenshots` : `${group.label} screenshots (${n + 1} of ${chunks.length})`;
      return {
        slug: `screenshots/${group.key}${n === 0 ? "" : `-${n + 1}`}`,
        title,
        blocks: [
          // Publishing requires exactly one H1; the page title alone does not count.
          { id: "h1", type: "heading", props: { text: title, level: 1 } },
          ...chunk.flatMap((shot) => [
            { id: `h-${shot.slug}`, type: "heading", props: { text: shot.title || shot.url, level: 2 } },
            { id: `t-${shot.slug}`, type: "text", props: { body: shot.url } },
            {
              id: `g-${shot.slug}`,
              type: "gallery",
              props: {
                items: shot.files.map((file) => ({
                  assetId: assetFor(file),
                  caption: variantOf(file),
                })),
              },
            },
          ]),
        ],
      };
    });
    indexBlocks.push(
      { id: `h-${group.key}`, type: "heading", props: { text: group.label, level: 2 } },
      {
        id: `t-${group.key}`,
        type: "text",
        props: {
          body: `${group.shots.length} screens, ${group.shots.length * 4} images` +
            (group.pages.length > 1 ? ` across ${group.pages.length} pages` : "") + ".",
        },
      },
      { id: `b-${group.key}`, type: "button", props: { label: `View ${group.label.toLowerCase()}`, href: `/${group.pages[0].slug}`, variant: "quiet" } },
    );
    pages.push(...group.pages);
  }

  pages.unshift({
    slug: "screenshots",
    title: "Screenshots",
    blocks: indexBlocks,
  });
  return pages.map((page) => ({
    ...page,
    seo: { title: page.title.slice(0, 60), description: `Living screenshots of every screen (MASTER.md C3.29): ${page.title}.`.slice(0, 155) },
  }));
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function failure(message, cause) {
  const error = new Error(message, { cause });
  error.isUsage = true;
  return error;
}

async function request(baseUrl, token, path, init, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${token}`, ...init?.headers },
      });
    } catch (error) {
      lastError = error;
      response = undefined;
    }
    if (response && response.status !== 429 && response.status < 500) {
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw failure(`${init?.method ?? "GET"} ${path} failed: HTTP ${response.status} ${body?.error?.message ?? ""}`.trim());
      }
      return body;
    }
    lastError ??= new Error(`HTTP ${response?.status}`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
  }
  throw failure(`${init?.method ?? "GET"} ${path} failed after ${attempts} attempts`, lastError);
}

async function callService(baseUrl, token, service, input) {
  return request(baseUrl, token, `/api/v1/${service}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input ?? {}),
  });
}

/** Every image asset in the library, keyed `${filename}#${checksumSha256}`. */
async function existingAssets(baseUrl, token) {
  const byFingerprint = new Map();
  let offset = 0;
  for (;;) {
    const page = await callService(baseUrl, token, "media.list", { kind: "image", limit: 100, offset });
    for (const row of page.rows ?? []) {
      if (row.filename && row.checksumSha256) {
        byFingerprint.set(`${row.filename}#${row.checksumSha256}`, row.id);
      }
    }
    offset += page.rows?.length ?? 0;
    if (offset >= (page.total ?? 0) || (page.rows ?? []).length === 0) return byFingerprint;
  }
}

async function uploadAsset(baseUrl, token, directory, file, altText) {
  const bytes = await readFile(join(directory, file));
  const form = new FormData();
  form.set("file", new Blob([bytes], { type: "image/webp" }), file);
  form.set("altText", altText);
  const body = await request(baseUrl, token, "/api/media", { method: "POST", body: form });
  if (!body?.id) throw failure(`upload of ${file} returned no asset id`);
  return body.id;
}

async function upsertPage(baseUrl, token, existingBySlug, page) {
  const existing = existingBySlug.get(page.slug);
  if (existing) {
    const updated = await callService(baseUrl, token, "cms.updatePage", {
      id: existing.id,
      expectedVersion: existing.version,
      title: page.title,
      blocks: page.blocks,
      seo: page.seo,
    });
    await callService(baseUrl, token, "cms.publishPage", { id: updated.id, published: true, expectedVersion: updated.version });
    return updated;
  }
  const created = await callService(baseUrl, token, "cms.createPage", {
    slug: page.slug,
    title: page.title,
    blocks: page.blocks,
    seo: page.seo,
  });
  await callService(baseUrl, token, "cms.publishPage", { id: created.id, published: true, expectedVersion: created.version });
  return created;
}

async function main() {
  const directory = process.argv[2] ?? "test-results/screenshots";
  const baseUrl = process.env.FREEHOLDER_GALLERY_URL?.replace(/\/+$/, "");
  const token = process.env.FREEHOLDER_GALLERY_TOKEN;
  if (!baseUrl || !token) {
    throw failure("Set FREEHOLDER_GALLERY_URL and FREEHOLDER_GALLERY_TOKEN (a scoped agent key with media.* and cms.*).");
  }

  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  const shots = manifest.shots ?? [];
  if (shots.length === 0) throw failure(`${directory}/manifest.json has no shots.`);

  const wanted = new Map(); // capture filename → alt text
  for (const shot of shots) {
    for (const file of shot.files) wanted.set(file, `${shot.title || shot.url} — ${variantOf(file)}`);
  }

  const library = await existingAssets(baseUrl, token);
  const assetFor = new Map();
  let uploaded = 0;
  for (const [file, altText] of wanted) {
    const fingerprint = `${file}#${await sha256(join(directory, file))}`;
    const existing = library.get(fingerprint);
    if (existing) {
      assetFor.set(file, existing);
      continue;
    }
    assetFor.set(file, await uploadAsset(baseUrl, token, directory, file, altText));
    uploaded += 1;
    // Stay polite under the API's rate limits on a first, full run.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const pages = buildPages(shots, (file) => assetFor.get(file), manifest);
  const existingPages = await callService(baseUrl, token, "cms.listPages", {});
  const existingBySlug = new Map((existingPages ?? []).map((page) => [page.slug, page]));
  const liveSlugs = new Set(pages.map((page) => page.slug));
  for (const page of pages) {
    await upsertPage(baseUrl, token, existingBySlug, page);
  }
  // A capture that needs fewer pages than the last one must not leave stale
  // gallery chunks published.
  let retired = 0;
  for (const page of existingBySlug.values()) {
    if (page.slug.startsWith("screenshots") && !liveSlugs.has(page.slug) && page.status === "published") {
      await callService(baseUrl, token, "cms.publishPage", { id: page.id, published: false, expectedVersion: page.version });
      retired += 1;
    }
  }
  console.log(`gallery: ${assetFor.size} images (${uploaded} uploaded), ${pages.length} pages, ${retired} retired`);
  for (const page of pages) console.log(`  /${page.slug}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
