// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Consent, preference, and privacy-rights services (MASTER.md C1.08, §30).
import { createHash } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { roleGrants, sessions, users } from "@/core/auth/schema";
import {
  contactMergeOperations,
  contactRelationships,
  contacts,
  customerMagicLinks,
  mergeCandidates,
  timelineEvents,
} from "@/core/contacts/schema";
import {
  registerContactReference,
  updateContact,
} from "@/core/contacts/service";
import { db } from "@/core/db";
import { auditLog } from "@/core/events/schema";
import {
  consentRecords,
  dataRequestArtifacts,
  dataRequests,
  privacyRetentionExceptions,
} from "@/core/privacy/schema";
import {
  actorString,
  defineService,
  ServiceError,
  type Actor,
  type Tx,
} from "@/core/service";

export const CONSENT_PURPOSES = [
  "marketing",
  "analytics",
  "data_processing",
] as const;
export const CONSENT_CHANNELS = ["email", "sms", "push", "web"] as const;
export const MARKETING_CHANNELS = ["email", "sms", "push"] as const;
export const DATA_REQUEST_KINDS = [
  "access",
  "export",
  "correction",
  "erasure",
] as const;

const consentPurpose = z.enum(CONSENT_PURPOSES);
const consentChannel = z.enum(CONSENT_CHANNELS);
const marketingChannel = z.enum(MARKETING_CHANNELS);
const consentState = z.enum(["granted", "denied", "withdrawn"]);
const consentMethod = z.enum([
  "form",
  "preference_center",
  "double_opt_in",
  "verbal",
  "written",
  "contract",
  "import",
  "system",
]);
const dataRequestStatus = z.enum([
  "submitted",
  "verified",
  "in_progress",
  "completed",
  "partially_completed",
  "denied",
  "cancelled",
]);
const retentionReason = z.enum([
  "legal_obligation",
  "legal_claim",
  "contractual_obligation",
  "accounting_tax",
  "security_fraud",
]);

const evidenceValue = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const boundedEvidence = z
  .record(z.string().min(1).max(80), evidenceValue)
  .refine((value) => Object.keys(value).length <= 20, "Use at most 20 evidence fields.");
const note = z.string().trim().max(4_000).optional();
const correctionChanges = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    email: z.string().trim().email().max(320).nullable().optional(),
    phone: z.string().trim().max(50).nullable().optional(),
    preferredLocale: z.string().trim().max(35).nullable().optional(),
    timezone: z.string().trim().max(100).nullable().optional(),
    country: z.string().trim().length(2).nullable().optional(),
  })
  .refine(
    (value) => Object.values(value).some((item) => item !== undefined),
    "Choose at least one profile field to correct.",
  );

const requestDetails = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("access"), note }),
  z.object({ kind: z.literal("export"), note }),
  z.object({ kind: z.literal("erasure"), note }),
  z.object({ kind: z.literal("correction"), note, changes: correctionChanges }),
]);

type ConsentPurpose = z.infer<typeof consentPurpose>;
type ConsentChannel = z.infer<typeof consentChannel>;
type ConsentState = z.infer<typeof consentState>;
type RequestDetails = z.infer<typeof requestDetails>;

export interface ContactPrivacySource {
  /** Stable owner-facing retention scope. */
  scope: string;
  /** Physical tables this source covers; enforced by the completeness test. */
  tables: readonly string[];
  exportData: (tx: Tx, contactId: string) => Promise<unknown>;
  erase: (
    tx: Tx,
    contactId: string,
    context: { requestId: string },
  ) => Promise<{ affected: number }>;
}

const privacySourceRegistry: ContactPrivacySource[] = [];

/** Modules register personal-data export and erasure beside their own schema. */
export function registerContactPrivacySource(
  source: ContactPrivacySource,
): void {
  const existing = privacySourceRegistry.find((item) => item.scope === source.scope);
  if (
    existing &&
    existing.tables.length === source.tables.length &&
    existing.tables.every((table, index) => table === source.tables[index])
  ) {
    return;
  }
  if (existing) {
    throw new Error(`contact privacy source "${source.scope}" registered twice`);
  }
  privacySourceRegistry.push(source);
}

export function contactPrivacySources(): readonly ContactPrivacySource[] {
  return privacySourceRegistry;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1_000);
}

function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function artifactChecksum(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function requireUser(actor: Actor): Extract<Actor, { kind: "user" }> {
  if (actor.kind !== "user") {
    throw new ServiceError("permission", "Sign in as a person to continue.");
  }
  return actor;
}

async function requireContact(tx: Tx, id: string) {
  const [contact] = await tx
    .select()
    .from(contacts)
    .where(eq(contacts.id, id))
    .limit(1);
  if (!contact) throw new ServiceError("not_found", "That contact no longer exists.");
  return contact;
}

async function personalContact(tx: Tx, actor: Actor) {
  const user = requireUser(actor);
  const [contact] = await tx
    .select()
    .from(contacts)
    .where(eq(contacts.userId, user.userId))
    .limit(1);
  if (!contact) {
    throw new ServiceError(
      "not_found",
      "Your sign-in is not linked to a contact profile.",
    );
  }
  return contact;
}

function consentKey(purpose: ConsentPurpose, channel: ConsentChannel | null): string {
  return `${purpose}:${channel ?? "all"}`;
}

export interface EffectiveConsent {
  purpose: ConsentPurpose;
  channel: ConsentChannel | null;
  state: ConsentState | "expired";
  record: typeof consentRecords.$inferSelect | null;
}

function effectiveConsent(
  rows: Array<typeof consentRecords.$inferSelect>,
  now = new Date(),
): EffectiveConsent[] {
  const latest = new Map<string, typeof consentRecords.$inferSelect>();
  for (const row of rows) {
    const key = consentKey(row.purpose, row.channel);
    if (!latest.has(key)) latest.set(key, row);
  }
  const choices: Array<[ConsentPurpose, ConsentChannel | null]> = [
    ...MARKETING_CHANNELS.map(
      (channel) => ["marketing", channel] as [ConsentPurpose, ConsentChannel],
    ),
    ["analytics", "web"],
    ["data_processing", null],
  ];
  return choices.map(([purpose, channel]) => {
    const record = latest.get(consentKey(purpose, channel)) ?? null;
    return {
      purpose,
      channel,
      state:
        record?.expiresAt && record.expiresAt <= now
          ? "expired"
          : (record?.state ?? "denied"),
      record,
    };
  });
}

async function consentBundle(tx: Tx, contactId: string) {
  const history = await tx
    .select()
    .from(consentRecords)
    .where(eq(consentRecords.contactId, contactId))
    .orderBy(desc(consentRecords.occurredAt), desc(consentRecords.createdAt));
  return { effective: effectiveConsent(history), history };
}

const recordConsentInput = z
  .object({
    contactId: z.string().uuid(),
    purpose: consentPurpose,
    channel: consentChannel.nullable().optional(),
    state: consentState,
    method: consentMethod,
    termsVersion: z.string().trim().max(100).nullable().optional(),
    sourceUrl: z.string().trim().max(2_048).nullable().optional(),
    evidence: boundedEvidence.default({}),
    occurredAt: z.string().datetime().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .superRefine((input, ctx) => {
    if (input.purpose === "marketing" && !input.channel) {
      ctx.addIssue({
        code: "custom",
        path: ["channel"],
        message: "Marketing consent must name a channel.",
      });
    }
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    if (input.expiresAt && new Date(input.expiresAt) <= occurredAt) {
      ctx.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Expiry must be after the consent event.",
      });
    }
  });

async function insertConsent(
  tx: Tx,
  input: z.output<typeof recordConsentInput>,
  actor: Actor,
) {
  await requireContact(tx, input.contactId);
  const [record] = await tx
    .insert(consentRecords)
    .values({
      contactId: input.contactId,
      purpose: input.purpose,
      channel:
        input.channel ?? (input.purpose === "analytics" ? "web" : null),
      state: input.state,
      method: input.method,
      termsVersion: input.termsVersion ?? null,
      sourceUrl: input.sourceUrl ?? null,
      ip: actor.request?.ip ?? null,
      evidence: input.evidence,
      actor: actorString(actor),
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    })
    .returning();
  return record!;
}

export const recordConsent = defineService({
  name: "contacts.recordConsent",
  summary: "Append evidence of one contact's consent decision.",
  kind: "mutation",
  permission: "scoped",
  input: recordConsentInput,
  handler: async (input, ctx) => {
    const record = await insertConsent(ctx.tx, input, ctx.actor);
    ctx.setSubject("consent", record.id);
    await ctx.emitTimeline({
      contactId: record.contactId,
      eventType: "contact.consentChanged",
      subjectType: "consent",
      subjectId: record.id,
      payload: {
        purpose: record.purpose,
        channel: record.channel,
        state: record.state,
      },
    });
    ctx.queueEvent("contact.consentChanged", {
      contactId: record.contactId,
      purpose: record.purpose,
      channel: record.channel,
      state: record.state,
    });
    return record;
  },
});

export const getConsentPreferences = defineService({
  name: "contacts.getConsentPreferences",
  summary: "Read current consent choices and their immutable evidence history.",
  kind: "query",
  permission: "scoped",
  input: z.object({ contactId: z.string().uuid() }),
  handler: async (input, ctx) => {
    const contact = await requireContact(ctx.tx, input.contactId);
    return { contact, ...(await consentBundle(ctx.tx, contact.id)) };
  },
});

export const canContact = defineService({
  name: "contacts.canContact",
  summary: "Decide from immutable evidence whether one purpose and channel is allowed.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    contactId: z.string().uuid(),
    purpose: consentPurpose,
    channel: consentChannel.nullable(),
  }),
  handler: async (input, ctx) => {
    await requireContact(ctx.tx, input.contactId);
    const { effective } = await consentBundle(ctx.tx, input.contactId);
    const choice = effective.find(
      (item) => item.purpose === input.purpose && item.channel === input.channel,
    );
    const allowed = choice?.state === "granted";
    return {
      allowed,
      reason: allowed ? "granted" : (choice?.state ?? "no_evidence"),
      evidenceId: choice?.record?.id ?? null,
      expiresAt: choice?.record?.expiresAt ?? null,
    };
  },
});

export const getMyPrivacyProfile = defineService({
  name: "privacy.getMyProfile",
  summary: "Read the signed-in customer's profile and consent preferences.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  handler: async (_input, ctx) => {
    const contact = await personalContact(ctx.tx, ctx.actor);
    return {
      contact: {
        id: contact.id,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        preferredLocale: contact.preferredLocale,
        timezone: contact.timezone,
        country: contact.country,
      },
      ...(await consentBundle(ctx.tx, contact.id)),
    };
  },
});

export const setMyMarketingPreference = defineService({
  name: "privacy.setMyMarketingPreference",
  summary: "Grant or withdraw one marketing channel from the preference centre.",
  kind: "mutation",
  permission: "authenticated",
  input: z.object({
    channel: marketingChannel,
    state: z.enum(["granted", "withdrawn"]),
    termsVersion: z.string().trim().min(1).max(100),
  }),
  handler: async (input, ctx) => {
    const contact = await personalContact(ctx.tx, ctx.actor);
    const record = await insertConsent(
      ctx.tx,
      {
        contactId: contact.id,
        purpose: "marketing",
        channel: input.channel,
        state: input.state,
        method: "preference_center",
        termsVersion: input.termsVersion,
        sourceUrl: "/portal/privacy",
        evidence: {},
      },
      ctx.actor,
    );
    ctx.setSubject("consent", record.id);
    await ctx.emitTimeline({
      contactId: contact.id,
      eventType: "contact.consentChanged",
      subjectType: "consent",
      subjectId: record.id,
      payload: {
        purpose: "marketing",
        channel: input.channel,
        state: input.state,
      },
    });
    ctx.queueEvent("contact.consentChanged", {
      contactId: contact.id,
      purpose: "marketing",
      channel: input.channel,
      state: input.state,
    });
    return { contactId: contact.id, preference: record };
  },
});

function requestValues(
  details: RequestDetails,
  actor: Actor,
  contactId: string,
  verified: boolean,
  jurisdiction?: string | null,
) {
  const now = new Date();
  return {
    contactId,
    kind: details.kind,
    status: verified ? ("verified" as const) : ("submitted" as const),
    jurisdiction: jurisdiction || null,
    details,
    requestedBy: actorString(actor),
    verificationMethod: verified ? "authenticated_portal" : null,
    verifiedAt: verified ? now : null,
    // A conservative follow-up target, not a claim about any jurisdiction's law.
    responseDueAt: addDays(now, 30),
  };
}

export const createDataRequest = defineService({
  name: "contacts.createDataRequest",
  summary: "Record a privacy request for a contact and start its response clock.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    contactId: z.string().uuid(),
    jurisdiction: z.string().trim().max(100).nullable().optional(),
    request: requestDetails,
  }),
  handler: async (input, ctx) => {
    await requireContact(ctx.tx, input.contactId);
    const [request] = await ctx.tx
      .insert(dataRequests)
      .values(
        requestValues(
          input.request,
          ctx.actor,
          input.contactId,
          false,
          input.jurisdiction,
        ),
      )
      .returning();
    ctx.setSubject("dataRequest", request!.id);
    await ctx.emitTimeline({
      contactId: request!.contactId,
      eventType: "contact.dataRequestSubmitted",
      subjectType: "dataRequest",
      subjectId: request!.id,
      payload: { kind: request!.kind, status: request!.status },
    });
    ctx.queueEvent("contact.dataRequestSubmitted", {
      contactId: request!.contactId,
      dataRequestId: request!.id,
      kind: request!.kind,
    });
    return request!;
  },
});

export const createMyDataRequest = defineService({
  name: "privacy.createMyDataRequest",
  summary: "Submit a verified privacy request for the signed-in customer.",
  kind: "mutation",
  permission: "authenticated",
  input: z.object({
    jurisdiction: z.string().trim().max(100).nullable().optional(),
    request: requestDetails,
  }),
  handler: async (input, ctx) => {
    const contact = await personalContact(ctx.tx, ctx.actor);
    const [request] = await ctx.tx
      .insert(dataRequests)
      .values(
        requestValues(
          input.request,
          ctx.actor,
          contact.id,
          true,
          input.jurisdiction,
        ),
      )
      .returning();
    ctx.setSubject("dataRequest", request!.id);
    await ctx.emitTimeline({
      contactId: contact.id,
      eventType: "contact.dataRequestSubmitted",
      subjectType: "dataRequest",
      subjectId: request!.id,
      payload: { kind: request!.kind, status: request!.status },
    });
    ctx.queueEvent("contact.dataRequestSubmitted", {
      contactId: contact.id,
      dataRequestId: request!.id,
      kind: request!.kind,
    });
    return request!;
  },
});

async function requestWithDetails(tx: Tx, id: string) {
  const [request] = await tx
    .select()
    .from(dataRequests)
    .where(eq(dataRequests.id, id))
    .limit(1);
  if (!request) throw new ServiceError("not_found", "That privacy request is not here.");
  const [exceptions, artifact] = await Promise.all([
    tx
      .select()
      .from(privacyRetentionExceptions)
      .where(eq(privacyRetentionExceptions.dataRequestId, id))
      .orderBy(asc(privacyRetentionExceptions.scope)),
    tx
      .select({
        id: dataRequestArtifacts.id,
        filename: dataRequestArtifacts.filename,
        mime: dataRequestArtifacts.mime,
        sha256: dataRequestArtifacts.sha256,
        expiresAt: dataRequestArtifacts.expiresAt,
        createdAt: dataRequestArtifacts.createdAt,
      })
      .from(dataRequestArtifacts)
      .where(eq(dataRequestArtifacts.dataRequestId, id))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);
  return { request, exceptions, artifact };
}

export const listDataRequests = defineService({
  name: "contacts.listDataRequests",
  summary: "List contact privacy requests by status and response deadline.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    status: dataRequestStatus.optional(),
    contactId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).default(0),
  }),
  handler: (input, ctx) => {
    const where = and(
      input.status ? eq(dataRequests.status, input.status) : undefined,
      input.contactId ? eq(dataRequests.contactId, input.contactId) : undefined,
    );
    return ctx.tx
      .select({ request: dataRequests, contact: contacts })
      .from(dataRequests)
      .innerJoin(contacts, eq(contacts.id, dataRequests.contactId))
      .where(where)
      .orderBy(asc(dataRequests.responseDueAt), desc(dataRequests.createdAt))
      .limit(input.limit)
      .offset(input.offset);
  },
});

export const getDataRequest = defineService({
  name: "contacts.getDataRequest",
  summary: "Read one privacy request, its retention exceptions, and artifact metadata.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  handler: (input, ctx) => requestWithDetails(ctx.tx, input.id),
});

export const listMyDataRequests = defineService({
  name: "privacy.listMyDataRequests",
  summary: "List privacy requests belonging to the signed-in customer.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  handler: async (_input, ctx) => {
    const contact = await personalContact(ctx.tx, ctx.actor);
    return ctx.tx
      .select({
        request: dataRequests,
        artifact: {
          id: dataRequestArtifacts.id,
          filename: dataRequestArtifacts.filename,
          sha256: dataRequestArtifacts.sha256,
          expiresAt: dataRequestArtifacts.expiresAt,
        },
      })
      .from(dataRequests)
      .leftJoin(
        dataRequestArtifacts,
        eq(dataRequestArtifacts.dataRequestId, dataRequests.id),
      )
      .where(eq(dataRequests.contactId, contact.id))
      .orderBy(desc(dataRequests.createdAt));
  },
});

const openRequestStatuses = ["submitted", "verified", "in_progress"] as const;

function isOpenRequestStatus(status: string): boolean {
  return (openRequestStatuses as readonly string[]).includes(status);
}

export const verifyDataRequest = defineService({
  name: "contacts.verifyDataRequest",
  summary: "Confirm the requester's identity before personal data is handled.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid(), method: z.string().trim().min(1).max(200) }),
  handler: async (input, ctx) => {
    const [request] = await ctx.tx
      .update(dataRequests)
      .set({
        status: "verified",
        verificationMethod: input.method,
        verifiedAt: new Date(),
      })
      .where(
        and(
          eq(dataRequests.id, input.id),
          eq(dataRequests.status, "submitted"),
        ),
      )
      .returning();
    if (!request) {
      throw new ServiceError("conflict", "That request is not awaiting verification.");
    }
    ctx.setSubject("dataRequest", request.id);
    await ctx.emitTimeline({
      contactId: request.contactId,
      eventType: "contact.dataRequestVerified",
      subjectType: "dataRequest",
      subjectId: request.id,
      payload: { kind: request.kind },
    });
    ctx.queueEvent("contact.dataRequestVerified", {
      contactId: request.contactId,
      dataRequestId: request.id,
      kind: request.kind,
    });
    return request;
  },
});

export const startDataRequest = defineService({
  name: "contacts.startDataRequest",
  summary: "Mark a verified privacy request as actively being handled.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const [request] = await ctx.tx
      .update(dataRequests)
      .set({ status: "in_progress" })
      .where(
        and(
          eq(dataRequests.id, input.id),
          eq(dataRequests.status, "verified"),
        ),
      )
      .returning();
    if (!request) {
      throw new ServiceError("conflict", "Verify that request before starting it.");
    }
    ctx.setSubject("dataRequest", request.id);
    return request;
  },
});

export const addRetentionException = defineService({
  name: "contacts.addPrivacyRetentionException",
  summary: "Document why one data scope must survive an erasure request.",
  kind: "mutation",
  permission: "scoped",
  input: z
    .object({
      dataRequestId: z.string().uuid(),
      scope: z.string().trim().min(1).max(200),
      reason: retentionReason,
      legalBasis: z.string().trim().min(1).max(1_000),
      notes: z.string().trim().max(4_000).nullable().optional(),
      expiresAt: z.string().datetime().nullable().optional(),
    })
    .refine(
      (input) => !input.expiresAt || new Date(input.expiresAt) > new Date(),
      { path: ["expiresAt"], message: "Expiry must be in the future." },
    ),
  handler: async (input, ctx) => {
    const [request] = await ctx.tx
      .select()
      .from(dataRequests)
      .where(eq(dataRequests.id, input.dataRequestId))
      .limit(1);
    if (!request) throw new ServiceError("not_found", "That privacy request is not here.");
    if (request.kind !== "erasure" || !isOpenRequestStatus(request.status)) {
      throw new ServiceError(
        "conflict",
        "Retention exceptions belong only to open erasure requests.",
      );
    }
    if (!privacySourceRegistry.some((source) => source.scope === input.scope)) {
      throw new ServiceError("validation", "Choose a registered personal-data scope.");
    }
    const [exception] = await ctx.tx
      .insert(privacyRetentionExceptions)
      .values({
        dataRequestId: request.id,
        scope: input.scope,
        reason: input.reason,
        legalBasis: input.legalBasis,
        notes: input.notes ?? null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        createdBy: actorString(ctx.actor),
      })
      .onConflictDoUpdate({
        target: [
          privacyRetentionExceptions.dataRequestId,
          privacyRetentionExceptions.scope,
        ],
        set: {
          reason: input.reason,
          legalBasis: input.legalBasis,
          notes: input.notes ?? null,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          createdBy: actorString(ctx.actor),
        },
      })
      .returning();
    ctx.setSubject("retentionException", exception!.id);
    return exception!;
  },
});

export const removeRetentionException = defineService({
  name: "contacts.removePrivacyRetentionException",
  summary: "Remove a no-longer-applicable erasure retention exception.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const [exception] = await ctx.tx
      .delete(privacyRetentionExceptions)
      .where(eq(privacyRetentionExceptions.id, input.id))
      .returning();
    if (!exception) {
      throw new ServiceError("not_found", "That retention exception is not here.");
    }
    ctx.setSubject("retentionException", exception.id);
    return { ok: true };
  },
});

export const cancelMyDataRequest = defineService({
  name: "privacy.cancelMyDataRequest",
  summary: "Cancel the signed-in customer's open privacy request.",
  kind: "mutation",
  permission: "authenticated",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const contact = await personalContact(ctx.tx, ctx.actor);
    const [request] = await ctx.tx
      .update(dataRequests)
      .set({ status: "cancelled", resolution: "Cancelled by the requester." })
      .where(
        and(
          eq(dataRequests.id, input.id),
          eq(dataRequests.contactId, contact.id),
          inArray(dataRequests.status, [...openRequestStatuses]),
        ),
      )
      .returning();
    if (!request) {
      throw new ServiceError("conflict", "That request can no longer be cancelled.");
    }
    ctx.setSubject("dataRequest", request.id);
    return request;
  },
});

async function saveArtifact(
  tx: Tx,
  request: typeof dataRequests.$inferSelect,
  body: unknown,
) {
  const filename = `freeholder-${request.kind}-${request.id}.json`;
  const values = {
    dataRequestId: request.id,
    filename,
    mime: "application/json",
    body,
    sha256: artifactChecksum(body),
    expiresAt: addDays(new Date(), 30),
    lastDownloadedAt: null,
  };
  const [artifact] = await tx
    .insert(dataRequestArtifacts)
    .values(values)
    .onConflictDoUpdate({
      target: dataRequestArtifacts.dataRequestId,
      set: {
        filename: values.filename,
        mime: values.mime,
        body: values.body,
        sha256: values.sha256,
        expiresAt: values.expiresAt,
        lastDownloadedAt: null,
        createdAt: new Date(),
      },
    })
    .returning();
  return artifact!;
}

async function portableExport(
  tx: Tx,
  request: typeof dataRequests.$inferSelect,
  contact: typeof contacts.$inferSelect,
) {
  const consent = await consentBundle(tx, contact.id);
  const sources: Record<string, unknown> = {};
  for (const source of privacySourceRegistry) {
    sources[source.scope] = await source.exportData(tx, contact.id);
  }
  return {
    format: "freeholder.contact-export",
    version: 1,
    generatedAt: new Date().toISOString(),
    request: {
      id: request.id,
      kind: request.kind,
      requestedAt: request.createdAt,
    },
    contact,
    preferences: consent.effective,
    consentHistory: consent.history,
    sources,
  };
}

function scrubContactSnapshot(value: unknown): Record<string, unknown> {
  const id =
    value && typeof value === "object" && "id" in value
      ? String(value.id)
      : "erased";
  return { id, name: "Erased contact", erased: true };
}

registerContactPrivacySource({
  scope: "contact.timeline",
  tables: ["timeline_events"],
  exportData: (tx, contactId) =>
    tx
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.contactId, contactId))
      .orderBy(asc(timelineEvents.occurredAt)),
  erase: async (tx, contactId) => {
    const rows = await tx
      .update(timelineEvents)
      .set({ subjectId: null, payload: { erased: true } })
      .where(eq(timelineEvents.contactId, contactId))
      .returning({ id: timelineEvents.id });
    return { affected: rows.length };
  },
});

registerContactPrivacySource({
  scope: "contact.relationships",
  tables: ["contact_relationships"],
  exportData: (tx, contactId) =>
    tx
      .select()
      .from(contactRelationships)
      .where(
        or(
          eq(contactRelationships.fromContactId, contactId),
          eq(contactRelationships.toContactId, contactId),
        ),
      ),
  erase: async (tx, contactId) => {
    const rows = await tx
      .delete(contactRelationships)
      .where(
        or(
          eq(contactRelationships.fromContactId, contactId),
          eq(contactRelationships.toContactId, contactId),
        ),
      )
      .returning({ id: contactRelationships.id });
    return { affected: rows.length };
  },
});

registerContactPrivacySource({
  scope: "contact.credentials",
  tables: ["customer_magic_links"],
  exportData: async (tx, contactId) => {
    const contact = await requireContact(tx, contactId);
    const links = await tx
      .select({
        id: customerMagicLinks.id,
        email: customerMagicLinks.email,
        expiresAt: customerMagicLinks.expiresAt,
        usedAt: customerMagicLinks.usedAt,
        createdAt: customerMagicLinks.createdAt,
      })
      .from(customerMagicLinks)
      .where(eq(customerMagicLinks.contactId, contactId));
    if (!contact.userId) return { account: null, sessions: [], magicLinks: links };
    const [account] = await tx
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.id, contact.userId))
      .limit(1);
    const accountSessions = await tx
      .select({
        id: sessions.id,
        expiresAt: sessions.expiresAt,
        lastSeenAt: sessions.lastSeenAt,
        createdAt: sessions.createdAt,
      })
      .from(sessions)
      .where(eq(sessions.userId, contact.userId));
    return { account: account ?? null, sessions: accountSessions, magicLinks: links };
  },
  erase: async (tx, contactId) => {
    const contact = await requireContact(tx, contactId);
    const links = await tx
      .delete(customerMagicLinks)
      .where(eq(customerMagicLinks.contactId, contactId))
      .returning({ id: customerMagicLinks.id });
    if (!contact.userId) return { affected: links.length };
    const [account] = await tx
      .select()
      .from(users)
      .where(eq(users.id, contact.userId))
      .limit(1);
    if (!account) return { affected: links.length };
    const grants = await tx
      .select({ module: roleGrants.module })
      .from(roleGrants)
      .where(eq(roleGrants.roleKey, account.role));
    if (account.role !== "customer" || grants.length > 0) {
      throw new ServiceError(
        "conflict",
        "This contact is linked to a staff-capable login. Unlink or reassign that login before erasure.",
      );
    }
    await tx.delete(users).where(eq(users.id, account.id));
    return { affected: links.length + 1 };
  },
});

registerContactPrivacySource({
  scope: "contact.merge_history",
  tables: ["merge_candidates"],
  exportData: async (tx, contactId) => ({
    candidates: await tx
      .select()
      .from(mergeCandidates)
      .where(
        or(
          eq(mergeCandidates.contactAId, contactId),
          eq(mergeCandidates.contactBId, contactId),
        ),
      ),
    operations: await tx
      .select()
      .from(contactMergeOperations)
      .where(
        or(
          eq(contactMergeOperations.survivingContactId, contactId),
          eq(contactMergeOperations.duplicateContactId, contactId),
        ),
      ),
  }),
  erase: async (tx, contactId) => {
    const candidates = await tx
      .select()
      .from(mergeCandidates)
      .where(
        or(
          eq(mergeCandidates.contactAId, contactId),
          eq(mergeCandidates.contactBId, contactId),
        ),
      );
    for (const candidate of candidates) {
      await tx
        .update(mergeCandidates)
        .set({
          contactAName:
            candidate.contactAId === contactId
              ? "Erased contact"
              : candidate.contactAName,
          contactAEmail:
            candidate.contactAId === contactId ? null : candidate.contactAEmail,
          contactBName:
            candidate.contactBId === contactId
              ? "Erased contact"
              : candidate.contactBName,
          contactBEmail:
            candidate.contactBId === contactId ? null : candidate.contactBEmail,
          reasons: [],
        })
        .where(eq(mergeCandidates.id, candidate.id));
    }
    const operations = await tx
      .select()
      .from(contactMergeOperations)
      .where(
        or(
          eq(contactMergeOperations.survivingContactId, contactId),
          eq(contactMergeOperations.duplicateContactId, contactId),
        ),
      );
    for (const operation of operations) {
      await tx
        .update(contactMergeOperations)
        .set({
          survivorBefore: scrubContactSnapshot(operation.survivorBefore),
          duplicateBefore: scrubContactSnapshot(operation.duplicateBefore),
          survivorAfter: scrubContactSnapshot(operation.survivorAfter),
          referenceState: [],
          undoable: false,
          undoBlockers: [
            ...operation.undoBlockers,
            "Personal data was erased after this merge, so it cannot be undone.",
          ],
        })
        .where(eq(contactMergeOperations.id, operation.id));
    }
    return { affected: candidates.length + operations.length };
  },
});

registerContactPrivacySource({
  scope: "contact.audit",
  tables: ["audit_log"],
  exportData: async (tx, contactId) => {
    const requestIds = await tx
      .select({ id: dataRequests.id })
      .from(dataRequests)
      .where(eq(dataRequests.contactId, contactId));
    return tx
      .select()
      .from(auditLog)
      .where(
        or(
          and(eq(auditLog.subjectType, "contact"), eq(auditLog.subjectId, contactId)),
          requestIds.length
            ? and(
                eq(auditLog.subjectType, "dataRequest"),
                inArray(
                  auditLog.subjectId,
                  requestIds.map((row) => row.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(asc(auditLog.at));
  },
  erase: async (tx, contactId) => {
    const contact = await requireContact(tx, contactId);
    const requestIds = await tx
      .select({ id: dataRequests.id })
      .from(dataRequests)
      .where(eq(dataRequests.contactId, contactId));
    const contactRows = await tx
      .update(auditLog)
      .set({ diff: {} })
      .where(
        or(
          and(eq(auditLog.subjectType, "contact"), eq(auditLog.subjectId, contactId)),
          requestIds.length
            ? and(
                eq(auditLog.subjectType, "dataRequest"),
                inArray(
                  auditLog.subjectId,
                  requestIds.map((row) => row.id),
                ),
              )
            : undefined,
        ),
      )
      .returning({ id: auditLog.id });
    if (contact.userId) {
      await tx
        .update(auditLog)
        .set({ actor: "erased:user" })
        .where(eq(auditLog.actor, `user:${contact.userId}`));
    }
    return { affected: contactRows.length };
  },
});

registerContactPrivacySource({
  scope: "privacy.records",
  tables: ["consent_records", "data_requests"],
  exportData: async (tx, contactId) => {
    const requests = await tx
      .select()
      .from(dataRequests)
      .where(eq(dataRequests.contactId, contactId))
      .orderBy(asc(dataRequests.createdAt));
    const artifacts = requests.length
      ? await tx
          .select({
            id: dataRequestArtifacts.id,
            dataRequestId: dataRequestArtifacts.dataRequestId,
            filename: dataRequestArtifacts.filename,
            mime: dataRequestArtifacts.mime,
            sha256: dataRequestArtifacts.sha256,
            expiresAt: dataRequestArtifacts.expiresAt,
            createdAt: dataRequestArtifacts.createdAt,
          })
          .from(dataRequestArtifacts)
          .where(
            inArray(
              dataRequestArtifacts.dataRequestId,
              requests.map((row) => row.id),
            ),
          )
      : [];
    return {
      consent: await tx
        .select()
        .from(consentRecords)
        .where(eq(consentRecords.contactId, contactId))
        .orderBy(asc(consentRecords.occurredAt)),
      requests,
      artifacts,
    };
  },
  erase: async (tx, contactId, context) => {
    const requests = await tx
      .select({ id: dataRequests.id })
      .from(dataRequests)
      .where(eq(dataRequests.contactId, contactId));
    let affected = 0;
    if (requests.length) {
      const removed = await tx
        .delete(dataRequestArtifacts)
        .where(
          and(
            inArray(
              dataRequestArtifacts.dataRequestId,
              requests.map((row) => row.id),
            ),
            sql`${dataRequestArtifacts.dataRequestId} <> ${context.requestId}`,
          ),
        )
        .returning({ id: dataRequestArtifacts.id });
      affected += removed.length;
      const scrubbed = await tx
        .update(dataRequests)
        .set({
          jurisdiction: null,
          details: {},
          requestedBy: "erased",
          verificationMethod: "identity verified before erasure",
          resolution: "Personal details erased.",
        })
        .where(eq(dataRequests.contactId, contactId))
        .returning({ id: dataRequests.id });
      affected += scrubbed.length;
      await tx
        .update(privacyRetentionExceptions)
        .set({ notes: null })
        .where(
          inArray(
            privacyRetentionExceptions.dataRequestId,
            requests.map((row) => row.id),
          ),
        );
    }
    const consent = await tx
      .update(consentRecords)
      .set({
        termsVersion: null,
        sourceUrl: null,
        ip: null,
        evidence: {},
        actor: "erased",
      })
      .where(eq(consentRecords.contactId, contactId))
      .returning({ id: consentRecords.id });
    return { affected: affected + consent.length };
  },
});

async function eraseContact(
  tx: Tx,
  request: typeof dataRequests.$inferSelect,
) {
  const now = new Date();
  const exceptions = (
    await tx
      .select()
      .from(privacyRetentionExceptions)
      .where(eq(privacyRetentionExceptions.dataRequestId, request.id))
  ).filter((item) => !item.expiresAt || item.expiresAt > now);
  const byScope = new Map(exceptions.map((item) => [item.scope, item]));
  const outcomes: Array<Record<string, unknown>> = [];
  for (const source of privacySourceRegistry) {
    const exception = byScope.get(source.scope);
    if (exception) {
      outcomes.push({
        scope: source.scope,
        outcome: "retained",
        reason: exception.reason,
        legalBasis: exception.legalBasis,
        expiresAt: exception.expiresAt,
      });
      continue;
    }
    const result = await source.erase(tx, request.contactId, {
      requestId: request.id,
    });
    outcomes.push({
      scope: source.scope,
      outcome: "erased",
      affected: result.affected,
    });
  }
  const [contact] = await tx
    .update(contacts)
    .set({
      userId: null,
      name: "Erased contact",
      email: null,
      phone: null,
      orgId: null,
      source: "privacy-erasure",
      tags: [],
      customFields: {},
      lifecycleStage: "lead",
      preferredLocale: null,
      timezone: null,
      country: null,
      ownerNotes: null,
    })
    .where(eq(contacts.id, request.contactId))
    .returning();
  if (!contact) throw new ServiceError("not_found", "That contact no longer exists.");
  await tx.insert(consentRecords).values(
    MARKETING_CHANNELS.map((channel) => ({
      contactId: contact.id,
      purpose: "marketing" as const,
      channel,
      state: "withdrawn" as const,
      method: "system" as const,
      evidence: { reason: "privacy_erasure", dataRequestId: request.id },
      actor: "system:privacy-erasure",
      occurredAt: now,
    })),
  );
  return { contact, outcomes, partiallyCompleted: exceptions.length > 0 };
}

export const fulfillDataRequest = defineService({
  name: "contacts.fulfillDataRequest",
  summary: "Fulfill a verified access, export, correction, or erasure request.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({
    id: z.string().uuid(),
    confirmation: z.string().max(20).optional(),
  }),
  handler: async (input, ctx) => {
    await ctx.tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`privacy:${input.id}`}))`,
    );
    const [request] = await ctx.tx
      .select()
      .from(dataRequests)
      .where(eq(dataRequests.id, input.id))
      .limit(1);
    if (!request) throw new ServiceError("not_found", "That privacy request is not here.");
    if (request.status !== "verified" && request.status !== "in_progress") {
      throw new ServiceError(
        "conflict",
        "Verify this request before fulfilling it, or leave a completed request unchanged.",
      );
    }
    const contact = await requireContact(ctx.tx, request.contactId);
    let artifactBody: unknown;
    let status: "completed" | "partially_completed" = "completed";
    let eventPayload: Record<string, unknown> = { kind: request.kind };
    if (request.kind === "access" || request.kind === "export") {
      artifactBody = await portableExport(ctx.tx, request, contact);
    } else if (request.kind === "correction") {
      const details = requestDetails.parse(request.details);
      if (details.kind !== "correction") {
        throw new ServiceError("conflict", "The correction details are incomplete.");
      }
      const updated = await ctx.call(updateContact, {
        id: contact.id,
        ...details.changes,
      });
      artifactBody = {
        format: "freeholder.correction-receipt",
        version: 1,
        generatedAt: new Date().toISOString(),
        requestId: request.id,
        contactId: contact.id,
        correctedFields: Object.keys(details.changes),
        profile: updated,
      };
      eventPayload = {
        ...eventPayload,
        correctedFields: Object.keys(details.changes),
      };
    } else {
      if (input.confirmation !== "ERASE") {
        throw new ServiceError(
          "validation",
          'Type "ERASE" to confirm this irreversible privacy operation.',
        );
      }
      const result = await eraseContact(ctx.tx, request);
      status = result.partiallyCompleted ? "partially_completed" : "completed";
      artifactBody = {
        format: "freeholder.erasure-receipt",
        version: 1,
        generatedAt: new Date().toISOString(),
        requestId: request.id,
        contactId: result.contact.id,
        status,
        outcomes: result.outcomes,
        note:
          status === "partially_completed"
            ? "Named data scopes were retained only for the documented legal reasons shown above."
            : "Personal fields and registered module data were erased or anonymized.",
      };
      await ctx.emitTimeline({
        contactId: request.contactId,
        eventType: "contact.dataErased",
        subjectType: "dataRequest",
        subjectId: request.id,
        payload: { status },
      });
      ctx.queueEvent("contact.dataErased", {
        contactId: request.contactId,
        dataRequestId: request.id,
        status,
      });
      eventPayload = { ...eventPayload, status };
    }
    const artifact = await saveArtifact(ctx.tx, request, artifactBody);
    const resolution =
      status === "partially_completed"
        ? "Completed with documented legal-retention exceptions."
        : "Request completed.";
    const [completed] = await ctx.tx
      .update(dataRequests)
      .set({ status, resolution, fulfilledAt: new Date() })
      .where(
        and(
          eq(dataRequests.id, request.id),
          inArray(dataRequests.status, ["verified", "in_progress"]),
        ),
      )
      .returning();
    if (!completed) {
      throw new ServiceError("conflict", "That request changed while it was being fulfilled.");
    }
    ctx.setSubject("dataRequest", completed.id);
    await ctx.emitTimeline({
      contactId: completed.contactId,
      eventType: "contact.dataRequestCompleted",
      subjectType: "dataRequest",
      subjectId: completed.id,
      payload: eventPayload,
    });
    ctx.queueEvent("contact.dataRequestCompleted", {
      contactId: completed.contactId,
      dataRequestId: completed.id,
      kind: completed.kind,
      status: completed.status,
    });
    return { request: completed, artifact };
  },
});

export const denyDataRequest = defineService({
  name: "contacts.denyDataRequest",
  summary: "Close a privacy request with a documented reason.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: z.string().uuid(),
    resolution: z.string().trim().min(1).max(4_000),
  }),
  handler: async (input, ctx) => {
    const [request] = await ctx.tx
      .update(dataRequests)
      .set({
        status: "denied",
        resolution: input.resolution,
        fulfilledAt: new Date(),
      })
      .where(
        and(
          eq(dataRequests.id, input.id),
          inArray(dataRequests.status, [...openRequestStatuses]),
        ),
      )
      .returning();
    if (!request) throw new ServiceError("conflict", "That request is already closed.");
    ctx.setSubject("dataRequest", request.id);
    await ctx.emitTimeline({
      contactId: request.contactId,
      eventType: "contact.dataRequestCompleted",
      subjectType: "dataRequest",
      subjectId: request.id,
      payload: { kind: request.kind, status: "denied" },
    });
    ctx.queueEvent("contact.dataRequestCompleted", {
      contactId: request.contactId,
      dataRequestId: request.id,
      kind: request.kind,
      status: "denied",
    });
    return request;
  },
});

async function artifactById(tx: Tx, id: string) {
  const [row] = await tx
    .select({ artifact: dataRequestArtifacts, request: dataRequests })
    .from(dataRequestArtifacts)
    .innerJoin(dataRequests, eq(dataRequests.id, dataRequestArtifacts.dataRequestId))
    .where(eq(dataRequestArtifacts.id, id))
    .limit(1);
  if (!row) throw new ServiceError("not_found", "That privacy artifact is not here.");
  if (row.artifact.expiresAt <= new Date()) {
    throw new ServiceError("not_found", "That privacy artifact has expired.");
  }
  return row;
}

async function markArtifactDownloaded(tx: Tx, id: string) {
  const [artifact] = await tx
    .update(dataRequestArtifacts)
    .set({ lastDownloadedAt: new Date() })
    .where(eq(dataRequestArtifacts.id, id))
    .returning();
  return artifact!;
}

function downloadableArtifact(artifact: typeof dataRequestArtifacts.$inferSelect) {
  const content = canonicalJson(artifact.body);
  return {
    id: artifact.id,
    filename: artifact.filename,
    mime: artifact.mime,
    sha256: artifact.sha256,
    expiresAt: artifact.expiresAt,
    content,
  };
}

export const downloadDataRequestArtifact = defineService({
  name: "contacts.downloadDataRequestArtifact",
  summary: "Read and audit one protected privacy artifact.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const row = await artifactById(ctx.tx, input.id);
    const artifact = await markArtifactDownloaded(ctx.tx, row.artifact.id);
    ctx.setSubject("dataRequest", row.request.id);
    return downloadableArtifact(artifact);
  },
});

export const downloadMyDataRequestArtifact = defineService({
  name: "privacy.downloadMyDataRequestArtifact",
  summary: "Download a protected privacy artifact belonging to the signed-in customer.",
  kind: "mutation",
  permission: "authenticated",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const contact = await personalContact(ctx.tx, ctx.actor);
    const row = await artifactById(ctx.tx, input.id);
    if (row.request.contactId !== contact.id) {
      throw new ServiceError("not_found", "That privacy artifact is not here.");
    }
    const artifact = await markArtifactDownloaded(ctx.tx, row.artifact.id);
    ctx.setSubject("dataRequest", row.request.id);
    return downloadableArtifact(artifact);
  },
});

export async function pruneExpiredPrivacyArtifacts(): Promise<number> {
  const rows = await db()
    .delete(dataRequestArtifacts)
    .where(lt(dataRequestArtifacts.expiresAt, new Date()))
    .returning({ id: dataRequestArtifacts.id });
  return rows.length;
}

const privacyPointerState = z.array(
  z.object({ id: z.string().uuid(), contactId: z.string().uuid() }),
);

registerContactReference({
  table: "consent_records",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(consentRecords)
      .set({ contactId: survivingId })
      .where(eq(consentRecords.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: consentRecords.id, contactId: consentRecords.contactId })
      .from(consentRecords)
      .where(inArray(consentRecords.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, afterState, duplicateId) => {
    const before = privacyPointerState.parse(beforeState);
    const after = privacyPointerState.parse(afterState);
    const current = after.length
      ? await tx
          .select({ id: consentRecords.id, contactId: consentRecords.contactId })
          .from(consentRecords)
          .where(inArray(consentRecords.id, after.map((row) => row.id)))
      : [];
    const byId = new Map(current.map((row) => [row.id, row.contactId]));
    if (
      current.length !== after.length ||
      after.some((row) => byId.get(row.id) !== row.contactId)
    ) {
      throw new ServiceError(
        "conflict",
        "Consent evidence changed after this merge. Leave the merge in place or restore the evidence first.",
      );
    }
    const moved = before.filter((row) => row.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(consentRecords)
        .set({ contactId: duplicateId })
        .where(inArray(consentRecords.id, moved.map((row) => row.id)));
    }
  },
});

registerContactReference({
  table: "data_requests",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(dataRequests)
      .set({ contactId: survivingId })
      .where(eq(dataRequests.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: dataRequests.id, contactId: dataRequests.contactId })
      .from(dataRequests)
      .where(inArray(dataRequests.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, afterState, duplicateId) => {
    const before = privacyPointerState.parse(beforeState);
    const after = privacyPointerState.parse(afterState);
    const current = after.length
      ? await tx
          .select({ id: dataRequests.id, contactId: dataRequests.contactId })
          .from(dataRequests)
          .where(inArray(dataRequests.id, after.map((row) => row.id)))
      : [];
    const byId = new Map(current.map((row) => [row.id, row.contactId]));
    if (
      current.length !== after.length ||
      after.some((row) => byId.get(row.id) !== row.contactId)
    ) {
      throw new ServiceError(
        "conflict",
        "A privacy request changed after this merge. Leave the merge in place or restore the request first.",
      );
    }
    const moved = before.filter((row) => row.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(dataRequests)
        .set({ contactId: duplicateId })
        .where(inArray(dataRequests.id, moved.map((row) => row.id)));
    }
  },
});

export default [
  recordConsent,
  getConsentPreferences,
  canContact,
  getMyPrivacyProfile,
  setMyMarketingPreference,
  createDataRequest,
  createMyDataRequest,
  listDataRequests,
  getDataRequest,
  listMyDataRequests,
  verifyDataRequest,
  startDataRequest,
  addRetentionException,
  removeRetentionException,
  cancelMyDataRequest,
  fulfillDataRequest,
  denyDataRequest,
  downloadDataRequestArtifact,
  downloadMyDataRequestArtifact,
];
