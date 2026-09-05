// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Following a catalogue, and installing from one (MASTER.md §40, C4.23).
//
// Four things have to be true of anything that arrives this way, and each is
// enforced here rather than described in a README:
//
//   - **Declared scopes are shown before approval.** An owner should not have
//     to read a brief to discover what it wants to be allowed to do.
//   - **Compatibility is checked**, so a definition written for a later
//     Freeholder is refused with a reason instead of failing at run time.
//   - **Provenance survives the catalogue.** Source, version and checksum are
//     copied onto the install, because "where did this come from?" is asked
//     months later and usually about something surprising.
//   - **Definitions are data.** No credential, no bound connection, no live
//     agent. Anything that arrives holding one of those is refused, and what
//     is installed arrives switched off for the owner to point at a worker of
//     their own.
import { createHash } from "node:crypto";
import { z } from "zod";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { satisfies } from "@freeholder/plugin-kit";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { providerJson } from "@/adapters/mail/http";
import { getPinnedBytes } from "@/core/http/pinned-download";
import { violates } from "@/core/db/errors";
import {
  catalogueEntries,
  catalogueInstalls,
  catalogueSources,
  CATALOGUE_KINDS,
} from "@/core/catalogue/schema";
import {
  defineService,
  getService,
  ServiceError,
  type Actor,
} from "@/core/service";

/** The version this instance reports for compatibility checks. */
const PLATFORM_VERSION = process.env.npm_package_version ?? "0.0.0";
const MAX_ENTRIES = 200;

function requirePerson(actor: Actor): string {
  if (actor.kind !== "user") {
    throw new ServiceError(
      "permission",
      "Following a catalogue is a decision a person makes. Sign in to make it.",
    );
  }
  return actor.userId;
}

/**
 * Keys that mean a definition is carrying something it must not.
 *
 * A definition is a brief and its parameters. Anything that looks like a
 * credential, a bound account or a live worker is refused outright rather than
 * stripped: an author who shipped one has misunderstood what they were
 * publishing, and quietly removing it would hide that from both of us.
 */
const FORBIDDEN_KEYS = [
  "credentials",
  "credential",
  "apikey",
  "api_key",
  "token",
  "secret",
  "password",
  "connectionid",
  "connection_id",
  "connectedaccountid",
  "agentid",
  "agent_id",
  "defaultagentid",
  "default_agent_id",
];

/** Walk the document and refuse anything carrying authority. */
function assertPureData(document: unknown, path = "document"): void {
  if (Array.isArray(document)) {
    document.forEach((item, index) => assertPureData(item, `${path}[${index}]`));
    return;
  }
  if (!document || typeof document !== "object") return;
  for (const [key, value] of Object.entries(document as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.includes(key.toLowerCase())) {
      throw new ServiceError(
        "validation",
        `That definition carries "${key}" at ${path}. A shared definition is instructions, never a credential or a bound account — the person installing it points it at their own worker.`,
      );
    }
    assertPureData(value, `${path}.${key}`);
  }
}

const catalogueEntryDocument = z.object({
  slug: z.string().trim().min(1).max(120),
  kind: z.enum(CATALOGUE_KINDS),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(4_000).default(""),
  version: z.string().trim().min(1).max(40),
  /** Semver range, e.g. `^1.0.0`. Absent means the author made no claim. */
  freeholder: z.string().trim().max(80).nullish(),
  declaredScopes: z.array(z.string().trim().max(120)).max(50).default([]),
  author: z.string().trim().max(200).nullish(),
  license: z.string().trim().max(80).nullish(),
  /** The portable document `agents.importPlaybook` already accepts. */
  definition: z.record(z.string(), z.unknown()),
});

const catalogueIndex = z.object({
  freeholderCatalogue: z.literal(1),
  name: z.string().trim().max(200).optional(),
  entries: z.array(catalogueEntryDocument).max(MAX_ENTRIES),
});

const sourceRow = row({
  id: uuid,
  name: z.string(),
  url: z.string(),
  enabled: z.boolean(),
  lastFetchedAt: timestamp.nullable(),
  lastError: z.string().nullable(),
});

const entryRow = row({
  id: uuid,
  sourceId: uuid,
  slug: z.string(),
  kind: z.enum(CATALOGUE_KINDS),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  freeholderRange: z.string().nullable(),
  declaredScopes: z.array(z.string()),
  author: z.string().nullable(),
  license: z.string().nullable(),
  checksum: z.string(),
  fetchedAt: timestamp,
});

function checksum(document: unknown): string {
  return createHash("sha256").update(JSON.stringify(document)).digest("hex");
}

/** Whether this instance can run it, and a sentence saying why not. */
function compatibility(range: string | null | undefined): {
  compatible: boolean;
  reason: string | null;
} {
  if (!range) {
    return {
      compatible: true,
      reason: null,
    };
  }
  try {
    return satisfies(PLATFORM_VERSION, range)
      ? { compatible: true, reason: null }
      : {
          compatible: false,
          reason: `This needs Freeholder ${range}; this instance is ${PLATFORM_VERSION}.`,
        };
  } catch {
    return { compatible: false, reason: `"${range}" is not a version range I can read.` };
  }
}

export const addCatalogueSource = defineService({
  name: "catalogue.addSource",
  summary: "Follow a catalogue of shareable agent and playbook definitions.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  stepUp: true,
  input: z.object({
    name: z.string().trim().min(1).max(120),
    url: z.string().trim().url().max(500),
  }),
  output: sourceRow,
  handler: async (input, ctx) => {
    const userId = requirePerson(ctx.actor);
    if (!input.url.startsWith("https://")) {
      throw new ServiceError(
        "validation",
        "A catalogue is fetched over HTTPS. Anything else can be rewritten in transit.",
      );
    }
    const [created] = await ctx.tx
      .insert(catalogueSources)
      .values({ name: input.name, url: input.url, addedBy: userId })
      .returning()
      .catch((error: unknown) => {
        if (violates(error, "catalogue_sources_url_idx")) {
          throw new ServiceError("conflict", "That catalogue is already being followed.");
        }
        throw error;
      });
    ctx.setSubject("catalogue_source", created!.id);
    ctx.queueEvent("catalogue.sourceAdded", { id: created!.id, url: created!.url });
    return created!;
  },
});

export const removeCatalogueSource = defineService({
  name: "catalogue.removeSource",
  summary: "Stop following a catalogue.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: uuid }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    // Its cached entries go with it; what was already installed does not.
    // An installed playbook is the owner's now.
    const [removed] = await ctx.tx
      .delete(catalogueSources)
      .where(eq(catalogueSources.id, input.id))
      .returning({ id: catalogueSources.id });
    if (!removed) throw new ServiceError("not_found", "No such catalogue.");
    ctx.setSubject("catalogue_source", input.id);
    return removed;
  },
});

export const listCatalogueSources = defineService({
  name: "catalogue.sources",
  summary: "The catalogues this instance follows.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(sourceRow),
  handler: (_input, ctx) =>
    ctx.tx.select().from(catalogueSources).orderBy(asc(catalogueSources.name)),
});

export const refreshCatalogue = defineService({
  name: "catalogue.refresh",
  summary: "Fetch what a catalogue is offering now.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({ id: z.uuid() }),
  output: z.object({
    id: uuid,
    entries: z.number().int(),
    refused: z.number().int(),
    /** Set when the catalogue could not be read. A state, not an exception. */
    error: z.string().nullable(),
  }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [source] = await ctx.tx
      .select()
      .from(catalogueSources)
      .where(eq(catalogueSources.id, input.id))
      .limit(1);
    if (!source) throw new ServiceError("not_found", "No such catalogue.");

    let parsed: z.infer<typeof catalogueIndex>;
    try {
      const downloaded = await getPinnedBytes(source.url, {
        maxBytes: 256 * 1024,
        timeoutMs: 30_000,
        allowLocal: false,
        headers: { accept: "application/json" },
      });
      const response = new Response(downloaded.bytes, {
        status: downloaded.status,
        headers: downloaded.contentType
          ? { "content-type": downloaded.contentType }
          : undefined,
      });
      parsed = catalogueIndex.parse(await providerJson(response, "The catalogue"));
    } catch (error) {
      // A catalogue that cannot be read is a **state**, not an exception —
      // the same posture §41 takes towards a connection whose grant was
      // revoked. This is also the only shape that works: throwing here would
      // roll back the very row recording why it failed, and the owner would
      // be told nothing twice.
      const reason =
        error instanceof Error
          ? error.message.slice(0, 400)
          : "The catalogue could not be read.";
      await ctx.tx
        .update(catalogueSources)
        .set({ lastError: reason, updatedAt: sql`now()` })
        .where(eq(catalogueSources.id, source.id));
      ctx.setSubject("catalogue_source", source.id);
      return { id: source.id, entries: 0, refused: 0, error: reason };
    }

    let stored = 0;
    let refused = 0;
    for (const entry of parsed.entries) {
      try {
        // Refused at the door, so a definition carrying authority never
        // reaches a preview screen where somebody might approve it.
        assertPureData(entry.definition);
      } catch {
        refused += 1;
        continue;
      }
      await ctx.tx
        .insert(catalogueEntries)
        .values({
          sourceId: source.id,
          slug: entry.slug,
          kind: entry.kind,
          name: entry.name,
          description: entry.description,
          version: entry.version,
          freeholderRange: entry.freeholder ?? null,
          declaredScopes: entry.declaredScopes,
          author: entry.author ?? null,
          license: entry.license ?? null,
          document: entry.definition,
          checksum: checksum(entry.definition),
          fetchedAt: sql`now()`,
        })
        .onConflictDoUpdate({
          target: [catalogueEntries.sourceId, catalogueEntries.slug],
          set: {
            kind: entry.kind,
            name: entry.name,
            description: entry.description,
            version: entry.version,
            freeholderRange: entry.freeholder ?? null,
            declaredScopes: entry.declaredScopes,
            author: entry.author ?? null,
            license: entry.license ?? null,
            document: entry.definition,
            checksum: checksum(entry.definition),
            fetchedAt: sql`now()`,
            updatedAt: sql`now()`,
          },
        });
      stored += 1;
    }

    await ctx.tx
      .update(catalogueSources)
      .set({ lastFetchedAt: sql`now()`, lastError: null, updatedAt: sql`now()` })
      .where(eq(catalogueSources.id, source.id));

    ctx.setSubject("catalogue_source", source.id);
    ctx.queueEvent("catalogue.refreshed", { id: source.id, entries: stored, refused });
    return { id: source.id, entries: stored, refused, error: null };
  },
});

export const browseCatalogue = defineService({
  name: "catalogue.list",
  summary: "Everything the followed catalogues are offering.",
  kind: "query",
  permission: "scoped",
  input: z.object({ kind: z.enum(CATALOGUE_KINDS).optional() }),
  output: listed(entryRow.extend({ compatible: z.boolean(), sourceName: z.string() })),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select({
        id: catalogueEntries.id,
        sourceId: catalogueEntries.sourceId,
        slug: catalogueEntries.slug,
        kind: catalogueEntries.kind,
        name: catalogueEntries.name,
        description: catalogueEntries.description,
        version: catalogueEntries.version,
        freeholderRange: catalogueEntries.freeholderRange,
        declaredScopes: catalogueEntries.declaredScopes,
        author: catalogueEntries.author,
        license: catalogueEntries.license,
        checksum: catalogueEntries.checksum,
        fetchedAt: catalogueEntries.fetchedAt,
        createdAt: catalogueEntries.createdAt,
        updatedAt: catalogueEntries.updatedAt,
        sourceName: catalogueSources.name,
      })
      .from(catalogueEntries)
      .innerJoin(catalogueSources, eq(catalogueSources.id, catalogueEntries.sourceId))
      .where(
        and(
          eq(catalogueSources.enabled, true),
          input.kind ? eq(catalogueEntries.kind, input.kind) : undefined,
        ),
      )
      .orderBy(asc(catalogueEntries.name));
    return rows.map((entry) => ({
      ...entry,
      compatible: compatibility(entry.freeholderRange).compatible,
    }));
  },
});

export const previewCatalogueEntry = defineService({
  name: "catalogue.preview",
  summary: "Exactly what installing this would add, before anybody approves it.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: z.uuid() }),
  output: entryRow
    .extend({
      sourceName: z.string(),
      sourceUrl: z.string(),
      compatible: z.boolean(),
      incompatibleReason: z.string().nullable(),
      /** The brief in full: an owner approves words, not a title. */
      brief: z.string().nullable(),
      document: z.unknown(),
    })
    .nullable(),
  handler: async (input, ctx) => {
    const [entry] = await ctx.tx
      .select({
        id: catalogueEntries.id,
        sourceId: catalogueEntries.sourceId,
        slug: catalogueEntries.slug,
        kind: catalogueEntries.kind,
        name: catalogueEntries.name,
        description: catalogueEntries.description,
        version: catalogueEntries.version,
        freeholderRange: catalogueEntries.freeholderRange,
        declaredScopes: catalogueEntries.declaredScopes,
        author: catalogueEntries.author,
        license: catalogueEntries.license,
        checksum: catalogueEntries.checksum,
        fetchedAt: catalogueEntries.fetchedAt,
        createdAt: catalogueEntries.createdAt,
        updatedAt: catalogueEntries.updatedAt,
        document: catalogueEntries.document,
        sourceName: catalogueSources.name,
        sourceUrl: catalogueSources.url,
      })
      .from(catalogueEntries)
      .innerJoin(catalogueSources, eq(catalogueSources.id, catalogueEntries.sourceId))
      .where(eq(catalogueEntries.id, input.id))
      .limit(1);
    if (!entry) return null;

    const fit = compatibility(entry.freeholderRange);
    const document = entry.document as Record<string, unknown>;
    return {
      ...entry,
      compatible: fit.compatible,
      incompatibleReason: fit.reason,
      brief:
        typeof document.briefTemplate === "string" ? document.briefTemplate : null,
    };
  },
});

export const installCatalogueEntry = defineService({
  name: "catalogue.install",
  summary: "Install a definition an owner has read and approved.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  stepUp: true,
  input: z.object({
    id: z.uuid(),
    /**
     * The checksum the owner was shown.
     *
     * Approval is of specific bytes. A catalogue that changed an entry between
     * preview and install is refused rather than trusted, which is what makes
     * the preview an approval and not a suggestion.
     */
    approvedChecksum: z.string().trim().min(16).max(200),
    name: z.string().trim().min(1).max(120).optional(),
  }),
  output: z.object({
    installedId: uuid,
    kind: z.enum(CATALOGUE_KINDS),
    name: z.string(),
  }),
  handler: async (input, ctx) => {
    const userId = requirePerson(ctx.actor);
    const [entry] = await ctx.tx
      .select({
        id: catalogueEntries.id,
        slug: catalogueEntries.slug,
        kind: catalogueEntries.kind,
        name: catalogueEntries.name,
        version: catalogueEntries.version,
        freeholderRange: catalogueEntries.freeholderRange,
        checksum: catalogueEntries.checksum,
        document: catalogueEntries.document,
        sourceUrl: catalogueSources.url,
      })
      .from(catalogueEntries)
      .innerJoin(catalogueSources, eq(catalogueSources.id, catalogueEntries.sourceId))
      .where(eq(catalogueEntries.id, input.id))
      .limit(1);
    if (!entry) throw new ServiceError("not_found", "No such catalogue entry.");

    if (entry.checksum !== input.approvedChecksum) {
      throw new ServiceError(
        "conflict",
        "This entry changed since you looked at it. Read it again before installing.",
      );
    }
    const fit = compatibility(entry.freeholderRange);
    if (!fit.compatible) {
      throw new ServiceError("conflict", fit.reason ?? "That is not compatible.");
    }
    // Checked again at install, not only at fetch: the row could have been
    // written by an earlier version of this code, or by hand.
    assertPureData(entry.document);

    if (entry.kind !== "playbook") {
      throw new ServiceError(
        "conflict",
        "Only playbook definitions can be installed so far. An agent needs a worker to run it, which is a connection the owner sets up themselves.",
      );
    }

    // Through the same door a hand-written import uses, so the arriving
    // playbook lands disabled and unassigned exactly as C4.08 requires.
    const installed = (await ctx.call(getService("agents.importPlaybook"), {
      document: entry.document,
      ...(input.name ? { name: input.name } : {}),
    })) as { id: string; name: string };

    await ctx.tx.insert(catalogueInstalls).values({
      entryId: entry.id,
      // Copied, not joined: the source may be removed later and the question
      // "where did this come from?" outlives it.
      sourceUrl: entry.sourceUrl,
      slug: entry.slug,
      kind: entry.kind,
      version: entry.version,
      checksum: entry.checksum,
      installedId: installed.id,
      installedBy: userId,
    });

    ctx.setSubject("agent_playbook", installed.id);
    ctx.queueEvent("catalogue.installed", {
      id: installed.id,
      slug: entry.slug,
      sourceUrl: entry.sourceUrl,
    });
    return { installedId: installed.id, kind: entry.kind, name: installed.name };
  },
});

export const catalogueHistory = defineService({
  name: "catalogue.installs",
  summary: "What this instance installed from a catalogue, and from where.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(
    z.object({
      id: uuid,
      sourceUrl: z.string(),
      slug: z.string(),
      kind: z.enum(CATALOGUE_KINDS),
      version: z.string(),
      checksum: z.string(),
      installedId: uuid.nullable(),
      createdAt: timestamp,
    }),
  ),
  handler: (_input, ctx) =>
    ctx.tx
      .select({
        id: catalogueInstalls.id,
        sourceUrl: catalogueInstalls.sourceUrl,
        slug: catalogueInstalls.slug,
        kind: catalogueInstalls.kind,
        version: catalogueInstalls.version,
        checksum: catalogueInstalls.checksum,
        installedId: catalogueInstalls.installedId,
        createdAt: catalogueInstalls.createdAt,
      })
      .from(catalogueInstalls)
      .orderBy(desc(catalogueInstalls.createdAt))
      .limit(100),
});

export default [
  addCatalogueSource,
  removeCatalogueSource,
  listCatalogueSources,
  refreshCatalogue,
  browseCatalogue,
  previewCatalogueEntry,
  installCatalogueEntry,
  catalogueHistory,
];
