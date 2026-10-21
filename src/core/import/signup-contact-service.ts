// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner-controlled, optional post-account contact import (C7.16).
//
// This is an envelope around C7.07's existing reversible importer. Customers
// may stage only the sources, fields, and count the owner chose. Staging writes
// an inspectable ledger but no Contacts; commit delegates to the canonical
// importer, which resolves the spine, opens duplicate candidates, and records
// only a `contact_book` relationship. It never touches consent, invitations,
// subscriptions, or messaging.
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { contacts } from "@/core/contacts/schema";
import {
  authorizationUrl,
  callbackUrl,
  exchangeAuthorizationCode,
  fetchProviderIdentity,
  grantCapability,
  upsertConnectedAccount,
  type OAuthProvider,
} from "@/core/connections/oauth-core";
import { connectedAccounts, connectionCapabilities } from "@/core/connections/schema";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { mailOauthStates } from "@/core/mail/schema";
import {
  defineOrchestratedService,
  defineService,
  getService,
  ServiceError,
  type Actor,
  type ServiceContext,
  type Tx,
} from "@/core/service";
import { guessDelimiter, guessMapping, parseCsv, type ImportableField } from "./csv";
import {
  CONTACT_IMPORT_OUTCOMES,
  CONTACT_IMPORT_STATUSES,
  SIGNUP_CONTACT_IMPORT_FIELDS,
  SIGNUP_CONTACT_IMPORT_FLOWS,
  SIGNUP_CONTACT_IMPORT_SOURCES,
  contactImportRows,
  contactImports,
  signupContactImportChoices,
  signupContactImportPolicies,
} from "./contacts-schema";
import {
  providerContactSourceForUser,
  providerContactsForSource,
  type SignupContactField,
} from "./signup-contact-providers";
import { parseVCard } from "./vcard";

const FLOW = "portal_account" as const;
const CALLBACK_PATH = "/api/connections/signup-contacts";
const RETURN_TO = "/portal/contact-import";
const GOOGLE_CONTACTS_READ = "https://www.googleapis.com/auth/contacts.readonly";
const MICROSOFT_CONTACTS_READ = "Contacts.Read";
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const source = z.enum(SIGNUP_CONTACT_IMPORT_SOURCES);
const field = z.enum(SIGNUP_CONTACT_IMPORT_FIELDS);
const flow = z.enum(SIGNUP_CONTACT_IMPORT_FLOWS);

const policyRow = row({
  flow,
  enabled: z.boolean(),
  allowedSources: z.array(source),
  allowedFields: z.array(field),
  maxContacts: z.number().int(),
  updatedBy: uuid.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const importSummary = row({
  id: uuid,
  filename: z.string(),
  sourceKind: z.enum(["owner_csv", ...SIGNUP_CONTACT_IMPORT_SOURCES]),
  signupFlow: flow.nullable(),
  allowedFields: z.array(z.string()),
  status: z.enum(CONTACT_IMPORT_STATUSES),
  counts: z.unknown(),
  committedAt: timestamp.nullable(),
  revertedAt: timestamp.nullable(),
  createdAt: timestamp,
});

const importLine = row({
  id: uuid,
  lineNumber: z.number().int(),
  cells: z.array(z.string()),
  email: z.string().nullable(),
  outcome: z.enum(CONTACT_IMPORT_OUTCOMES),
  errors: z.array(z.string()),
  changes: z.unknown(),
  contactId: uuid.nullable(),
  created: z.boolean(),
  relationshipId: uuid.nullable(),
});

const batchView = importSummary.extend({
  headers: z.array(z.string()),
  mapping: z.array(z.string()),
  rows: listed(importLine),
});

const providerContactRow = row({
  externalId: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});

type Policy = typeof signupContactImportPolicies.$inferSelect;

function hashState(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function contactScope(provider: OAuthProvider): string {
  return provider === "google" ? GOOGLE_CONTACTS_READ : MICROSOFT_CONTACTS_READ;
}

function owner(actor: Actor): Extract<Actor, { kind: "user" }> {
  if (actor.kind !== "user" || actor.role !== "owner") {
    throw new ServiceError("permission", "Only the owner can change signup contact import rules.");
  }
  return actor;
}

async function customer(
  tx: Tx,
  actor: Actor,
): Promise<{ userId: string; contactId: string }> {
  if (actor.kind !== "user" || actor.grants.length !== 0) {
    throw new ServiceError("permission", "Sign in to your portal account to manage this import.");
  }
  const [contact] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.userId, actor.userId))
    .limit(1);
  if (!contact) {
    throw new ServiceError("permission", "This portal account is not linked to a contact.");
  }
  return { userId: actor.userId, contactId: contact.id };
}

async function loadPolicy(tx: Tx): Promise<Policy | null> {
  const [policy] = await tx
    .select()
    .from(signupContactImportPolicies)
    .where(eq(signupContactImportPolicies.flow, FLOW))
    .limit(1);
  return policy ?? null;
}

function activePolicy(policy: Policy | null): Policy {
  if (!policy?.enabled) {
    throw new ServiceError("permission", "Contact import is not offered for this signup flow.");
  }
  return policy;
}

async function choiceFor(tx: Tx, userId: string) {
  const [choice] = await tx
    .select()
    .from(signupContactImportChoices)
    .where(
      and(
        eq(signupContactImportChoices.userId, userId),
        eq(signupContactImportChoices.flow, FLOW),
      ),
    )
    .limit(1);
  return choice ?? null;
}

async function mayStart(tx: Tx, userId: string): Promise<void> {
  const choice = await choiceFor(tx, userId);
  if (choice?.status === "skipped" || choice?.status === "completed") {
    throw new ServiceError(
      "conflict",
      choice.status === "skipped"
        ? "This optional signup step was skipped."
        : "The signup contact import has already been completed.",
    );
  }
}

function selectedFields(requested: SignupContactField[], policy: Policy): SignupContactField[] {
  const unique = [...new Set(requested)];
  if (!unique.includes("email")) {
    throw new ServiceError("validation", "Email must be included so contacts can resolve safely.");
  }
  const allowed = new Set(policy.allowedFields);
  const refused = unique.filter((candidate) => !allowed.has(candidate));
  if (refused.length > 0) {
    throw new ServiceError("permission", `The owner has not enabled: ${refused.join(", ")}.`);
  }
  return unique;
}

function sourceAllowed(policy: Policy, requested: (typeof SIGNUP_CONTACT_IMPORT_SOURCES)[number]) {
  if (!policy.allowedSources.includes(requested)) {
    throw new ServiceError("permission", "That contact source is not enabled for this signup flow.");
  }
}

function clipped(value: string | null | undefined, max: number): string {
  return (value ?? "").trim().slice(0, max);
}

function structuredRows(
  contacts: Array<{ name?: string | null; email?: string | null; phone?: string | null }>,
  fields: SignupContactField[],
): { headers: string[]; mapping: ImportableField[]; body: string[][] } {
  const headers = fields.map((one) => one[0]!.toUpperCase() + one.slice(1));
  return {
    headers,
    mapping: [...fields],
    body: contacts.map((contact) =>
      fields.map((one) => clipped(contact[one], one === "email" ? 320 : 300)),
    ),
  };
}

async function stage(
  ctx: ServiceContext,
  identity: { userId: string; contactId: string },
  policy: Policy,
  input: {
    source: (typeof SIGNUP_CONTACT_IMPORT_SOURCES)[number];
    filename: string;
    fields: SignupContactField[];
    headers: string[];
    mapping: ImportableField[];
    body: string[][];
    delimiter?: string;
  },
) {
  if (input.body.length === 0) {
    throw new ServiceError("validation", "There are no contacts to preview.");
  }
  if (input.body.length > policy.maxContacts) {
    throw new ServiceError(
      "validation",
      `This signup flow allows at most ${policy.maxContacts} contacts.`,
    );
  }
  const [created] = await ctx.tx
    .insert(contactImports)
    .values({
      filename: input.filename,
      delimiter: input.delimiter ?? ",",
      headers: input.headers,
      mapping: input.mapping,
      source: `signup:${input.source}`,
      sourceKind: input.source,
      signupFlow: FLOW,
      subjectContactId: identity.contactId,
      allowedFields: input.fields,
      createdBy: identity.userId,
    })
    .returning();
  await ctx.tx.insert(contactImportRows).values(
    input.body.map((cells, index) => ({
      importId: created!.id,
      lineNumber: index + 1,
      cells,
    })),
  );

  await ctx.callAsSystem(getService("contactImports.map"), {
    id: created!.id,
    mapping: input.mapping,
  });
  await ctx.tx
    .insert(signupContactImportChoices)
    .values({ userId: identity.userId, flow: FLOW, status: "pending", importId: created!.id })
    .onConflictDoUpdate({
      target: [signupContactImportChoices.userId, signupContactImportChoices.flow],
      set: { status: "pending", importId: created!.id, decidedAt: null, updatedAt: sql`now()` },
    });
  ctx.setSubject("contactImport", created!.id);
  ctx.queueEvent("signupContactImport.previewed", {
    id: created!.id,
    source: input.source,
    rows: input.body.length,
    fields: input.fields,
  });
  return loadOwnedBatch(ctx.tx, identity.userId, created!.id);
}

async function loadOwnedBatch(tx: Tx, userId: string, importId: string) {
  const [batch] = await tx
    .select()
    .from(contactImports)
    .where(
      and(
        eq(contactImports.id, importId),
        eq(contactImports.createdBy, userId),
        eq(contactImports.signupFlow, FLOW),
      ),
    )
    .limit(1);
  if (!batch) throw new ServiceError("not_found", "That signup import is unavailable.");
  const rows = await tx
    .select()
    .from(contactImportRows)
    .where(eq(contactImportRows.importId, batch.id))
    .orderBy(asc(contactImportRows.lineNumber));
  return { ...batch, rows };
}

export const getSignupContactImportPolicy = defineService({
  name: "signupContactImports.getPolicy",
  summary: "Read the owner's policy for optional post-signup contact import.",
  kind: "query",
  permission: "scoped",
  agentCallable: false,
  input: z.object({ flow: flow.default(FLOW) }),
  output: policyRow.nullable(),
  handler: async (_input, ctx) => {
    owner(ctx.actor);
    return loadPolicy(ctx.tx);
  },
});

export const setSignupContactImportPolicy = defineService({
  name: "signupContactImports.setPolicy",
  summary: "Choose whether and how a signup flow offers contact import.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({
    flow: flow.default(FLOW),
    enabled: z.boolean(),
    allowedSources: z.array(source).max(SIGNUP_CONTACT_IMPORT_SOURCES.length),
    allowedFields: z.array(field).max(SIGNUP_CONTACT_IMPORT_FIELDS.length),
    maxContacts: z.number().int().min(1).max(500),
  }),
  output: policyRow,
  handler: async (input, ctx) => {
    const actor = owner(ctx.actor);
    const allowedSources = [...new Set(input.allowedSources)];
    const allowedFields = [...new Set(input.allowedFields)];
    if (input.enabled && allowedSources.length === 0) {
      throw new ServiceError("validation", "Enable at least one contact source.");
    }
    if (!allowedFields.includes("email")) {
      throw new ServiceError("validation", "Email must remain enabled for spine resolution.");
    }
    const [saved] = await ctx.tx
      .insert(signupContactImportPolicies)
      .values({ ...input, allowedSources, allowedFields, updatedBy: actor.userId })
      .onConflictDoUpdate({
        target: signupContactImportPolicies.flow,
        set: {
          enabled: input.enabled,
          allowedSources,
          allowedFields,
          maxContacts: input.maxContacts,
          updatedBy: actor.userId,
          updatedAt: sql`now()`,
        },
      })
      .returning();
    ctx.setSubject("signupContactImportPolicy", input.flow);
    ctx.queueEvent("signupContactImport.policyChanged", {
      flow: input.flow,
      enabled: input.enabled,
      allowedSources,
      allowedFields,
      maxContacts: input.maxContacts,
    });
    return saved!;
  },
});

export const getSignupContactImportOffer = defineService({
  name: "signupContactImports.getOffer",
  summary: "Read this portal member's optional import offer and prior batches.",
  kind: "query",
  permission: "authenticated",
  agentCallable: false,
  mcpExclude: true,
  input: z.object({ flow: flow.default(FLOW) }),
  output: row({
    enabled: z.boolean(),
    allowedSources: z.array(source),
    allowedFields: z.array(field),
    maxContacts: z.number().int(),
    decision: z.enum(["pending", "skipped", "completed"]).nullable(),
    batches: listed(importSummary),
    connections: listed(row({
      id: uuid,
      provider: z.enum(["google", "microsoft"]),
      email: z.string().nullable(),
    })),
  }),
  handler: async (_input, ctx) => {
    const identity = await customer(ctx.tx, ctx.actor);
    const [policy, choice, batches, rawConnections] = await Promise.all([
      loadPolicy(ctx.tx),
      choiceFor(ctx.tx, identity.userId),
      ctx.tx
        .select()
        .from(contactImports)
        .where(
          and(
            eq(contactImports.createdBy, identity.userId),
            eq(contactImports.signupFlow, FLOW),
          ),
        )
        .orderBy(desc(contactImports.createdAt)),
      ctx.tx
        .select({
          id: connectedAccounts.id,
          provider: connectedAccounts.provider,
          email: connectedAccounts.email,
        })
        .from(connectedAccounts)
        .innerJoin(
          connectionCapabilities,
          eq(connectionCapabilities.connectedAccountId, connectedAccounts.id),
        )
        .where(
          and(
            eq(connectedAccounts.userId, identity.userId),
            eq(connectionCapabilities.capability, "contacts_read"),
            eq(connectionCapabilities.enabled, true),
          ),
        ),
    ]);
    const connections = rawConnections.filter(
      (connection): connection is typeof connection & { provider: "google" | "microsoft" } =>
        connection.provider === "google" || connection.provider === "microsoft",
    );
    return {
      enabled: Boolean(policy?.enabled),
      allowedSources: policy?.allowedSources ?? [],
      allowedFields: policy?.allowedFields ?? [],
      maxContacts: policy?.maxContacts ?? 0,
      decision: choice?.status ?? null,
      batches,
      connections,
    };
  },
});

export const stageSignupContactFile = defineService({
  name: "signupContactImports.stageFile",
  summary: "Parse an allowed CSV or vCard into an exact, non-writing preview.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  mcpExclude: true,
  writeClass: "write",
  input: z.object({
    source: z.enum(["csv", "vcard"]),
    filename: z.string().trim().min(1).max(300),
    content: z.string().min(1).max(MAX_FILE_BYTES),
    fields: z.array(field).min(1).max(3),
  }),
  output: batchView,
  handler: async (input, ctx) => {
    const identity = await customer(ctx.tx, ctx.actor);
    const policy = activePolicy(await loadPolicy(ctx.tx));
    await mayStart(ctx.tx, identity.userId);
    sourceAllowed(policy, input.source);
    const fields = selectedFields(input.fields, policy);
    if (input.source === "vcard") {
      const parsed = parseVCard(input.content);
      const normalized = structuredRows(parsed, fields);
      return stage(ctx, identity, policy, {
        source: input.source,
        filename: input.filename,
        fields,
        ...normalized,
      });
    }
    const delimiter = guessDelimiter(input.content);
    const parsed = parseCsv(input.content, delimiter);
    if (parsed.length < 2) {
      throw new ServiceError("validation", "That CSV has a header row and nothing else in it.");
    }
    const headers = parsed[0]!.map((header) => header.trim());
    const allowed = new Set(fields);
    const mapping = guessMapping(headers).map((candidate) => {
      const parsedField = field.safeParse(candidate);
      return parsedField.success && allowed.has(parsedField.data)
        ? parsedField.data
        : "ignore";
    }) as ImportableField[];
    if (!mapping.includes("email")) {
      throw new ServiceError("validation", "The CSV needs a recognizable email column.");
    }
    return stage(ctx, identity, policy, {
      source: input.source,
      filename: input.filename,
      fields,
      headers,
      mapping,
      body: parsed.slice(1),
      delimiter,
    });
  },
});

const submittedContact = z.object({
  name: z.string().max(300).nullish(),
  email: z.string().max(320).nullish(),
  phone: z.string().max(100).nullish(),
});

export const stageDeviceContacts = defineService({
  name: "signupContactImports.stageDevice",
  summary: "Stage only the contacts a supported device picker returned.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  mcpExclude: true,
  writeClass: "write",
  input: z.object({
    contacts: z.array(submittedContact).min(1).max(500),
    fields: z.array(field).min(1).max(3),
  }),
  output: batchView,
  handler: async (input, ctx) => {
    const identity = await customer(ctx.tx, ctx.actor);
    const policy = activePolicy(await loadPolicy(ctx.tx));
    await mayStart(ctx.tx, identity.userId);
    sourceAllowed(policy, "device");
    const fields = selectedFields(input.fields, policy);
    return stage(ctx, identity, policy, {
      source: "device",
      filename: "device-selection.contacts",
      fields,
      ...structuredRows(input.contacts, fields),
    });
  },
});

export const getSignupContactImport = defineService({
  name: "signupContactImports.get",
  summary: "Read one exact signup import preview owned by this portal member.",
  kind: "query",
  permission: "authenticated",
  agentCallable: false,
  mcpExclude: true,
  input: z.object({ id: z.string().uuid() }),
  output: batchView,
  handler: async (input, ctx) => {
    const identity = await customer(ctx.tx, ctx.actor);
    return loadOwnedBatch(ctx.tx, identity.userId, input.id);
  },
});

export const commitSignupContactImport = defineService({
  name: "signupContactImports.commit",
  summary: "Apply this portal member's checked signup import.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  mcpExclude: true,
  writeClass: "write",
  input: z.object({ id: z.string().uuid() }),
  output: importSummary,
  handler: async (input, ctx) => {
    const identity = await customer(ctx.tx, ctx.actor);
    const batch = await loadOwnedBatch(ctx.tx, identity.userId, input.id);
    const policy = activePolicy(await loadPolicy(ctx.tx));
    sourceAllowed(policy, batch.sourceKind as (typeof SIGNUP_CONTACT_IMPORT_SOURCES)[number]);
    selectedFields(batch.allowedFields as SignupContactField[], policy);
    if (batch.rows.length > policy.maxContacts) {
      throw new ServiceError("permission", "The owner lowered the maximum before this import was applied.");
    }
    const committed = (await ctx.callAsSystem(getService("contactImports.commit"), {
      id: batch.id,
    })) as typeof contactImports.$inferSelect;
    await ctx.tx
      .insert(signupContactImportChoices)
      .values({
        userId: identity.userId,
        flow: FLOW,
        status: "completed",
        importId: batch.id,
        decidedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [signupContactImportChoices.userId, signupContactImportChoices.flow],
        set: {
          status: "completed",
          importId: batch.id,
          decidedAt: new Date(),
          updatedAt: sql`now()`,
        },
      });
    ctx.setSubject("contactImport", batch.id);
    return committed;
  },
});

export const revertSignupContactImport = defineService({
  name: "signupContactImports.revert",
  summary: "Remove a signup batch and its address-book relationships where safe.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  mcpExclude: true,
  writeClass: "destructive",
  input: z.object({ id: z.string().uuid() }),
  output: row({ id: uuid, restored: z.number().int(), deleted: z.number().int(), kept: z.number().int() }),
  handler: async (input, ctx) => {
    const identity = await customer(ctx.tx, ctx.actor);
    await loadOwnedBatch(ctx.tx, identity.userId, input.id);
    const result = (await ctx.callAsSystem(getService("contactImports.revert"), input)) as {
      id: string;
      restored: number;
      deleted: number;
      kept: number;
    };
    ctx.setSubject("contactImport", input.id);
    return result;
  },
});

export const skipSignupContactImport = defineService({
  name: "signupContactImports.skip",
  summary: "Skip the optional signup step without affecting the account.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  mcpExclude: true,
  writeClass: "destructive",
  input: z.object({ id: z.string().uuid().optional() }),
  output: row({ skipped: z.literal(true) }),
  handler: async (input, ctx) => {
    const identity = await customer(ctx.tx, ctx.actor);
    if (input.id) {
      const batch = await loadOwnedBatch(ctx.tx, identity.userId, input.id);
      if (batch.status === "committed" || batch.status === "reverted") {
        throw new ServiceError("conflict", "Use undo for an import that was already applied.");
      }
      await ctx.tx.delete(contactImports).where(eq(contactImports.id, batch.id));
    }
    await ctx.tx
      .insert(signupContactImportChoices)
      .values({ userId: identity.userId, flow: FLOW, status: "skipped", decidedAt: new Date() })
      .onConflictDoUpdate({
        target: [signupContactImportChoices.userId, signupContactImportChoices.flow],
        set: { status: "skipped", importId: null, decidedAt: new Date(), updatedAt: sql`now()` },
      });
    ctx.setSubject("signupContactImportChoice", identity.userId);
    ctx.queueEvent("signupContactImport.skipped", { flow: FLOW, userId: identity.userId });
    return { skipped: true as const };
  },
});

export const beginSignupContactsOAuth = defineService({
  name: "signupContactImports.beginOAuth",
  summary: "Ask Google or Microsoft only for read-only contacts access.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  mcpExclude: true,
  writeClass: "write",
  input: z.object({ provider: z.enum(["google", "microsoft"]) }),
  output: row({ authorizationUrl: z.string().url() }),
  rateLimit: {
    limit: 10,
    windowSeconds: 15 * 60,
    subject: (input) => input.provider,
    message: "Too many contact connection attempts. Wait a few minutes and try again.",
  },
  handler: async (input, ctx) => {
    const identity = await customer(ctx.tx, ctx.actor);
    const policy = activePolicy(await loadPolicy(ctx.tx));
    await mayStart(ctx.tx, identity.userId);
    sourceAllowed(policy, input.provider);
    const state = randomBytes(32).toString("base64url");
    await ctx.tx.insert(mailOauthStates).values({
      tokenHash: hashState(state),
      userId: identity.userId,
      provider: input.provider,
      purpose: "signup_contacts",
      access: "read",
      returnTo: RETURN_TO,
      expiresAt: sql`now() + interval '10 minutes'`,
    });
    ctx.setSubject("connected_account", input.provider);
    return {
      authorizationUrl: authorizationUrl({
        provider: input.provider,
        redirectUri: callbackUrl(CALLBACK_PATH, input.provider),
        scopes: [contactScope(input.provider)],
        state,
      }),
    };
  },
});

const signupContactsOAuthCompletionInput = z.object({
  provider: z.enum(["google", "microsoft"]),
  state: z.string().min(30).max(200),
  code: z.string().min(1).max(4_000),
});

const signupContactsOAuthCompletionOutput = row({
  connectedAccountId: uuid,
  provider: z.enum(["google", "microsoft"]),
  email: z.string().nullable(),
  returnTo: z.string(),
});

const oauthCredentials = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
  expiresAt: z.string().datetime(),
  tokenType: z.string().min(1),
});

const providerIdentity = z.object({
  id: z.string().min(1),
  email: z.string().optional(),
  name: z.string().optional(),
});

const claimSignupContactsOAuthCompletion = defineService({
  name: "signupContactImports.claimOAuthCompletion",
  summary: "Atomically consume one signup-contacts OAuth state before its provider code is spent.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  mcpExclude: true,
  external: false,
  writeClass: "write",
  input: z.object({
    provider: z.enum(["google", "microsoft"]),
    stateToken: z.string().min(30).max(200),
  }),
  output: row({ returnTo: z.string() }),
  handler: async (input, ctx) => {
    const identity = await customer(ctx.tx, ctx.actor);
    const policy = activePolicy(await loadPolicy(ctx.tx));
    sourceAllowed(policy, input.provider);
    const [state] = await ctx.tx
      .update(mailOauthStates)
      .set({ consumedAt: sql`now()` })
      .where(
        and(
          eq(mailOauthStates.tokenHash, hashState(input.stateToken)),
          eq(mailOauthStates.userId, identity.userId),
          eq(mailOauthStates.provider, input.provider),
          eq(mailOauthStates.purpose, "signup_contacts"),
          isNull(mailOauthStates.consumedAt),
          gt(mailOauthStates.expiresAt, sql`now()`),
        ),
      )
      .returning();
    if (!state) {
      throw new ServiceError(
        "permission",
        "That contacts connection expired or belongs to another session.",
      );
    }
    ctx.setSubject("mail_oauth_state", state.tokenHash);
    return { returnTo: state.returnTo };
  },
});

const applySignupContactsOAuthCompletion = defineService({
  name: "signupContactImports.applyOAuthCompletion",
  summary: "Atomically store a signup contacts account after its provider handshake completes.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  mcpExclude: true,
  external: false,
  writeClass: "write",
  input: z.object({
    provider: z.enum(["google", "microsoft"]),
    returnTo: z.string(),
    credentials: oauthCredentials,
    scopes: z.array(z.string()),
    identity: providerIdentity,
  }),
  output: signupContactsOAuthCompletionOutput,
  handler: async (input, ctx) => {
    const identity = await customer(ctx.tx, ctx.actor);
    const policy = activePolicy(await loadPolicy(ctx.tx));
    sourceAllowed(policy, input.provider);
    const required = contactScope(input.provider);
    const stored = await upsertConnectedAccount(ctx, {
      userId: identity.userId,
      provider: input.provider,
      identity: { ...input.identity, email: input.identity.email },
      credentials: input.credentials,
      scopes: input.scopes,
      kind: "personal",
    });
    await grantCapability(ctx, stored.accountId, "contacts_read", required);
    await ctx.tx
      .insert(signupContactImportChoices)
      .values({ userId: identity.userId, flow: FLOW, status: "pending" })
      .onConflictDoNothing();
    ctx.setSubject("connected_account", stored.accountId);
    ctx.queueEvent("connection.contactsConnected", {
      id: stored.accountId,
      provider: input.provider,
      purpose: "signup",
    });
    return {
      connectedAccountId: stored.accountId,
      provider: input.provider,
      email: input.identity.email ?? null,
      returnTo: input.returnTo,
    };
  },
});

/** The provider exchange and identity lookup run between audited DB phases. */
export const completeSignupContactsOAuth = defineOrchestratedService({
  name: "signupContactImports.completeOAuth",
  summary: "Finish a read-only contacts connection for this portal member.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  mcpExclude: true,
  writeClass: "write",
  input: signupContactsOAuthCompletionInput,
  output: signupContactsOAuthCompletionOutput,
  handler: async (input, actor) => {
    const state = await claimSignupContactsOAuthCompletion.call(
      { provider: input.provider, stateToken: input.state },
      actor,
    );
    const required = contactScope(input.provider);
    const exchanged = await exchangeAuthorizationCode({
      provider: input.provider,
      code: input.code,
      redirectUri: callbackUrl(CALLBACK_PATH, input.provider),
      requiredScope: required,
      requiredScopeMessage: "Read-only contacts access was not granted.",
    });
    const identity = await fetchProviderIdentity(
      input.provider,
      exchanged.credentials.accessToken,
    );
    return applySignupContactsOAuthCompletion.call(
      {
        provider: input.provider,
        returnTo: state.returnTo,
        credentials: exchanged.credentials,
        scopes: exchanged.scopes,
        identity,
      },
      actor,
    );
  },
});

const signupProviderSourceOutput = row({
  accountId: uuid,
  provider: z.enum(["google", "microsoft"]),
  fields: z.array(field),
  maxContacts: z.number().int().positive(),
});

const signupProviderContactsOutput = row({
  provider: z.enum(["google", "microsoft"]),
  fields: z.array(field),
  maxContacts: z.number().int().positive(),
  contacts: listed(providerContactRow),
});

const signupProviderSource = defineService({
  name: "signupContactImports.providerSource",
  summary: "Read and authorize the bounded source for a signup contacts provider call.",
  kind: "query",
  permission: "authenticated",
  agentCallable: false,
  mcpExclude: true,
  external: false,
  input: z.object({ accountId: z.string().uuid() }),
  output: signupProviderSourceOutput,
  handler: async (input, ctx) => {
    const identity = await customer(ctx.tx, ctx.actor);
    const policy = activePolicy(await loadPolicy(ctx.tx));
    await mayStart(ctx.tx, identity.userId);
    const source = await providerContactSourceForUser(ctx.tx, {
      userId: identity.userId,
      accountId: input.accountId,
    });
    sourceAllowed(policy, source.provider);
    return {
      ...source,
      fields: policy.allowedFields as SignupContactField[],
      maxContacts: policy.maxContacts,
    };
  },
});

export const listSignupProviderContacts = defineOrchestratedService({
  name: "signupContactImports.listProviderContacts",
  summary: "List only owner-enabled fields for selection before import.",
  kind: "query",
  permission: "authenticated",
  agentCallable: false,
  mcpExclude: true,
  input: z.object({ accountId: z.string().uuid() }),
  output: signupProviderContactsOutput,
  handler: async (input, actor) => {
    const source = await signupProviderSource.call(input, actor);
    const result = await providerContactsForSource({
      ...source,
      limit: source.maxContacts,
    });
    return {
      ...result,
      fields: source.fields,
      maxContacts: source.maxContacts,
    };
  },
});

const applySignupProviderContacts = defineService({
  name: "signupContactImports.applyProviderContacts",
  summary: "Revalidate policy and atomically stage contacts fetched outside the transaction.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  mcpExclude: true,
  external: false,
  writeClass: "write",
  input: z.object({
    accountId: z.string().uuid(),
    externalIds: z.array(z.string().min(1).max(300)).min(1).max(500),
    response: z.object({
      provider: z.enum(["google", "microsoft"]),
      contacts: listed(providerContactRow),
    }),
  }),
  output: batchView,
  handler: async (input, ctx) => {
    const identity = await customer(ctx.tx, ctx.actor);
    const policy = activePolicy(await loadPolicy(ctx.tx));
    await mayStart(ctx.tx, identity.userId);
    const source = await providerContactSourceForUser(ctx.tx, {
      userId: identity.userId,
      accountId: input.accountId,
    });
    if (source.provider !== input.response.provider) {
      throw new ServiceError(
        "conflict",
        "That contacts connection changed while its address book was being read.",
      );
    }
    sourceAllowed(policy, source.provider);
    const fields = policy.allowedFields as SignupContactField[];
    const selected = new Set(input.externalIds);
    if (selected.size > policy.maxContacts) {
      throw new ServiceError(
        "validation",
        `Choose no more than ${policy.maxContacts} contacts.`,
      );
    }
    const contacts = input.response.contacts.filter((contact) =>
      selected.has(contact.externalId),
    );
    if (contacts.length !== selected.size) {
      throw new ServiceError(
        "validation",
        "One of those provider contacts is no longer available.",
      );
    }
    return stage(ctx, identity, policy, {
      source: source.provider,
      filename: `${source.provider}-selection.contacts`,
      fields,
      ...structuredRows(contacts, fields),
    });
  },
});

export const stageSignupProviderContacts = defineOrchestratedService({
  name: "signupContactImports.stageProvider",
  summary: "Stage the exact provider contacts this portal member selected.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  mcpExclude: true,
  writeClass: "write",
  input: z.object({
    accountId: z.string().uuid(),
    externalIds: z.array(z.string().min(1).max(300)).min(1).max(500),
  }),
  output: batchView,
  handler: async (input, actor) => {
    const source = await signupProviderSource.call(
      { accountId: input.accountId },
      actor,
    );
    const response = await providerContactsForSource({
      ...source,
      limit: source.maxContacts,
    });
    return applySignupProviderContacts.call(
      {
        accountId: input.accountId,
        externalIds: input.externalIds,
        response,
      },
      actor,
    );
  },
});

export const disconnectSignupContacts = defineService({
  name: "signupContactImports.disconnect",
  summary: "Forget a portal member's contacts connection and credentials.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  mcpExclude: true,
  writeClass: "destructive",
  input: z.object({ accountId: z.string().uuid() }),
  output: row({ disconnected: z.literal(true) }),
  handler: async (input, ctx) => {
    const identity = await customer(ctx.tx, ctx.actor);
    const [account] = await ctx.tx
      .select({ id: connectedAccounts.id })
      .from(connectedAccounts)
      .innerJoin(
        connectionCapabilities,
        eq(connectionCapabilities.connectedAccountId, connectedAccounts.id),
      )
      .where(
        and(
          eq(connectedAccounts.id, input.accountId),
          eq(connectedAccounts.userId, identity.userId),
          eq(connectionCapabilities.capability, "contacts_read"),
        ),
      )
      .limit(1);
    if (!account) throw new ServiceError("not_found", "That contacts connection is unavailable.");
    await ctx.tx.delete(connectedAccounts).where(eq(connectedAccounts.id, account.id));
    ctx.setSubject("connected_account", account.id);
    ctx.queueEvent("connection.contactsDisconnected", { id: account.id });
    return { disconnected: true as const };
  },
});

export default [
  getSignupContactImportPolicy,
  setSignupContactImportPolicy,
  getSignupContactImportOffer,
  stageSignupContactFile,
  stageDeviceContacts,
  getSignupContactImport,
  commitSignupContactImport,
  revertSignupContactImport,
  skipSignupContactImport,
  beginSignupContactsOAuth,
  completeSignupContactsOAuth,
  claimSignupContactsOAuthCompletion,
  applySignupContactsOAuthCompletion,
  listSignupProviderContacts,
  signupProviderSource,
  stageSignupProviderContacts,
  applySignupProviderContacts,
  disconnectSignupContacts,
];
