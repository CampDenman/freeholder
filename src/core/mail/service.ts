// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Canonical mail routing, delivery evidence, sender verification and suppression.
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { bulkMail, mail, mailConfigurationStatus } from "@/adapters/mail";
import { createGmailMail } from "@/adapters/mail/gmail";
import { createOutlookMail } from "@/adapters/mail/outlook";
import type {
  MailAdapter,
  MailProvider,
  OutboundEmail,
  SenderVerification,
} from "@/adapters/mail/types";
import { MailAdapterError } from "@/adapters/mail/types";
import { users } from "@/core/auth/schema";
import { db } from "@/core/db";
import { enqueueJob } from "@/core/jobs";
import { connectedAccounts, connectionCapabilities } from "@/core/connections/schema";
import {
  mailDeliveries,
  mailOutbox,
  mailProviderEvents,
  mailSenders,
  mailSuppressions,
} from "@/core/mail/schema";
import { oauthAccessTokenOutsideTransaction } from "@/core/mail/oauth";
import { decryptMailOutbox, encryptMailOutbox } from "@/core/mail/outbox-crypto";
import {
  defineService,
  ServiceError,
  actorString,
  type Actor,
  type Tx,
} from "@/core/service";

const address = z.string().trim().email().toLowerCase().max(320);
const senderProvider = z.enum([
  "smtp",
  "resend",
  "postmark",
  "ses",
]);

const mailProvider = z.enum([
  "gmail",
  "outlook",
  "smtp",
  "console",
  "resend",
  "postmark",
  "ses",
  "none",
]);

const mailSenderRow = row({
  id: uuid,
  purpose: z.enum(["transactional", "bulk"]),
  provider: z.enum([
    "gmail",
    "outlook",
    "smtp",
    "console",
    "resend",
    "postmark",
    "ses",
  ]),
  connectedAccountId: uuid.nullable(),
  email: z.string(),
  displayName: z.string().nullable(),
  providerIdentity: z.string().nullable(),
  verificationStatus: z.enum(["pending", "verified", "failed"]),
  status: z.enum(["active", "paused", "needs_attention"]),
  isDefault: z.boolean(),
  verificationDetail: z.unknown(),
  lastVerifiedAt: timestamp.nullable(),
  lastError: z.string().nullable(),
  createdBy: uuid.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const mailDeliveryRow = row({
  id: uuid,
  senderId: uuid.nullable(),
  purpose: z.enum(["transactional", "bulk"]),
  provider: mailProvider,
  recipient: z.string(),
  subject: z.string(),
  status: z.enum([
    "queued",
    "submitted",
    "delivered",
    "bounced",
    "complained",
    "failed",
    "suppressed",
  ]),
  providerRef: z.string().nullable(),
  idempotencyKey: z.string().nullable(),
  requestedBy: z.string(),
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  submittedAt: timestamp.nullable(),
  deliveredAt: timestamp.nullable(),
  providerStatusAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const mailSuppressionRow = row({
  email: z.string(),
  reason: z.enum(["hard_bounce", "complaint", "provider", "manual"]),
  provider: z.enum(["resend", "postmark", "ses", "manual"]),
  sourceEventId: uuid.nullable(),
  detail: z.string().nullable(),
  active: z.boolean(),
  releasedAt: timestamp.nullable(),
  releasedBy: uuid.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const mailConfiguration = z.object({
  transactional: z.object({
    provider: z.enum(["smtp", "console", "gmail", "outlook"]),
    delivers: z.boolean(),
    missing: z.array(z.string()),
    fromAddress: z.string().nullable(),
  }),
  oauth: listed(
    z.object({
      provider: z.enum(["google", "microsoft"]),
      configured: z.boolean(),
      missing: z.array(z.string()),
    }),
  ),
  bulk: z.object({
    provider: z.enum(["resend", "postmark", "ses", "none"]),
    sendConfigured: z.boolean(),
    feedbackConfigured: z.boolean(),
    missing: z.array(z.string()),
    webhookPath: z.string().nullable(),
    fromAddress: z.string().nullable(),
  }),
});

const mailSendResult = z.object({
  id: uuid,
  provider: mailProvider,
  providerRef: z.string().nullable(),
  delivers: z.boolean(),
  duplicate: z.boolean(),
});

type Purpose = "transactional" | "bulk";
type SenderRow = typeof mailSenders.$inferSelect & {
  accountStatus?: "active" | "needs_reconnect" | "revoked" | null;
  capabilityEnabled?: boolean | null;
};

function refuseAgent(actor: Actor, action: string): void {
  if (actor.kind === "agent") {
    throw new ServiceError(
      "permission",
      `An API key cannot ${action} mail providers. Sign in to manage them.`,
    );
  }
}

function providerForPurpose(purpose: Purpose): MailAdapter {
  return purpose === "bulk" ? bulkMail() : mail();
}

async function lockDefaultSender(tx: Tx, purpose: Purpose): Promise<void> {
  // The partial unique index rejects two defaults, but a rejection aborts the
  // caller's whole transaction. Serializing the tiny choose/register section
  // makes concurrent first-sender and switch-default requests deterministic.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`mail-default:${purpose}`}))`,
  );
}

async function getSender(tx: Tx, id: string): Promise<SenderRow> {
  const [row] = await tx
    .select({
      sender: mailSenders,
      accountStatus: connectedAccounts.status,
      capabilityEnabled: connectionCapabilities.enabled,
    })
    .from(mailSenders)
    .leftJoin(
      connectedAccounts,
      eq(connectedAccounts.id, mailSenders.connectedAccountId),
    )
    .leftJoin(
      connectionCapabilities,
      and(
        eq(connectionCapabilities.connectedAccountId, connectedAccounts.id),
        eq(connectionCapabilities.capability, "mail_send"),
      ),
    )
    .where(eq(mailSenders.id, id))
    .limit(1);
  if (!row) throw new ServiceError("not_found", "No such mail sender.");
  return {
    ...row.sender,
    accountStatus: row.accountStatus,
    capabilityEnabled: row.capabilityEnabled,
  };
}

async function defaultSender(tx: Tx, purpose: Purpose): Promise<SenderRow | undefined> {
  const [row] = await tx
    .select({ id: mailSenders.id })
    .from(mailSenders)
    .where(
      and(
        eq(mailSenders.purpose, purpose),
        eq(mailSenders.isDefault, true),
      ),
    )
    .limit(1);
  return row ? getSender(tx, row.id) : undefined;
}

function assertSenderReady(sender: SenderRow): void {
  if (sender.status !== "active") {
    throw new ServiceError("conflict", "That mail sender is paused or needs attention.");
  }
  if (sender.purpose === "bulk" && sender.verificationStatus !== "verified") {
    throw new ServiceError(
      "conflict",
      "Verify this bulk sender before using it. Until then no campaign can leave Freeholder.",
    );
  }
  if (sender.provider === "gmail" || sender.provider === "outlook") {
    if (
      !sender.connectedAccountId ||
      sender.accountStatus !== "active" ||
      !sender.capabilityEnabled
    ) {
      throw new ServiceError(
        "conflict",
        "That connected mailbox needs attention or mail-send permission is off.",
      );
    }
  }
}

function configuredAdapter(sender: SenderRow): MailAdapter {
  const configured = providerForPurpose(sender.purpose);
  if (configured.id !== sender.provider) {
    throw new ServiceError(
      "conflict",
      `This sender uses ${sender.provider}, but this deployment is configured for ${configured.id}.`,
    );
  }
  if (sender.purpose === "bulk") {
    const status = mailConfigurationStatus().bulk;
    if (!status.sendConfigured || !status.feedbackConfigured) {
      throw new ServiceError(
        "conflict",
        "Complete the bulk provider and authenticated delivery-feedback settings before sending.",
      );
    }
  }
  return configured;
}

function senderRoute(sender: SenderRow): {
  provider: MailProvider;
  delivers: boolean;
  kind: MailAdapter["kind"];
} {
  assertSenderReady(sender);
  if (sender.provider === "gmail" || sender.provider === "outlook") {
    return { provider: sender.provider, delivers: true, kind: "transactional" };
  }
  const adapter = configuredAdapter(sender);
  return { provider: adapter.id, delivers: adapter.delivers, kind: adapter.kind };
}

async function adapterFor(sender: SenderRow): Promise<MailAdapter> {
  assertSenderReady(sender);
  if (sender.provider === "gmail" || sender.provider === "outlook") {
    const provider = sender.provider === "gmail" ? "google" : "microsoft";
    const accessToken = await oauthAccessTokenOutsideTransaction({
      id: sender.connectedAccountId!,
      provider,
    });
    return sender.provider === "gmail"
      ? createGmailMail({ accessToken, from: sender.email })
      : createOutlookMail({ accessToken, from: sender.email });
  }
  return configuredAdapter(sender);
}

export interface MailSendOptions {
  purpose?: Purpose;
  senderId?: string;
  requestedBy?: string;
  idempotencyKey?: string;
}

export interface MailSendResult {
  id: string;
  provider: MailProvider;
  providerRef: string | null;
  delivers: boolean;
  duplicate: boolean;
}

const stagedMessage = z
  .object({
    to: address,
    subject: z.string().min(1).max(998).refine((value) => !/[\r\n]/.test(value)),
    text: z.string().max(2_000_000),
    html: z.string().max(4_000_000).optional(),
    replyTo: address.optional(),
    from: z.string().max(500).refine((value) => !/[\r\n]/.test(value)).optional(),
  })
  .strict();
type StagedMessage = z.output<typeof stagedMessage>;

function providerDelivers(provider: MailProvider): boolean {
  return provider !== "console" && provider !== "none";
}

/**
 * The one outbound mail path used by core and, later, campaign jobs.
 *
 * The body is encrypted into a short-lived outbox row and the transactional
 * job enqueue commits beside it. No provider or OAuth request happens here:
 * `deliverQueuedMail` runs after this transaction is gone. Bulk has no
 * fallback: a missing verified bulk sender is a refusal, never Gmail by
 * accident.
 */
export async function sendMail(
  tx: Tx,
  message: OutboundEmail,
  options: MailSendOptions = {},
): Promise<MailSendResult> {
  const purpose = options.purpose ?? "transactional";
  const prepared = stagedMessage.parse({ ...message, to: message.to });
  const recipient = prepared.to;
  const [suppressed] = await tx
    .select({ email: mailSuppressions.email, reason: mailSuppressions.reason })
    .from(mailSuppressions)
    .where(
      and(
        eq(mailSuppressions.email, recipient),
        eq(mailSuppressions.active, true),
      ),
    )
    .limit(1);
  if (suppressed) {
    throw new ServiceError(
      "conflict",
      `Mail to ${recipient} is suppressed after a ${suppressed.reason.replace("_", " ")}. Correct the address or release the suppression after verifying it.`,
    );
  }

  const sender = options.senderId
    ? await getSender(tx, options.senderId)
    : await defaultSender(tx, purpose);
  if (sender && sender.purpose !== purpose) {
    throw new ServiceError("validation", `That is not a ${purpose} mail sender.`);
  }
  if (!sender && purpose === "bulk") {
    throw new ServiceError(
      "conflict",
      "Choose and verify a default bulk sender before sending a campaign.",
    );
  }
  const route = sender
    ? senderRoute(sender)
    : (() => {
        const configured = providerForPurpose(purpose);
        return { provider: configured.id, delivers: configured.delivers, kind: configured.kind };
      })();
  if (purpose === "bulk" && route.kind === "transactional") {
    throw new ServiceError(
      "conflict",
      "A personal or transactional mailbox cannot be used for a broadcast.",
    );
  }

  const deliveryId = randomUUID();
  let inserted: { id: string } | undefined;
  if (options.idempotencyKey) {
    [inserted] = await tx
      .insert(mailDeliveries)
      .values({
        id: deliveryId,
        senderId: sender?.id,
        purpose,
        provider: route.provider,
        recipient,
        subject: prepared.subject,
        idempotencyKey: options.idempotencyKey,
        requestedBy: options.requestedBy ?? "system",
      })
      .onConflictDoNothing()
      .returning({ id: mailDeliveries.id });
    if (!inserted) {
      const [existing] = await tx
        .select({
          id: mailDeliveries.id,
          provider: mailDeliveries.provider,
          providerRef: mailDeliveries.providerRef,
          status: mailDeliveries.status,
        })
        .from(mailDeliveries)
        .where(eq(mailDeliveries.idempotencyKey, options.idempotencyKey))
        .limit(1);
      if (!existing) {
        throw new Error("Mail delivery idempotency conflict could not be resolved.");
      }
      return {
        id: existing.id,
        provider: existing.provider,
        providerRef: existing.providerRef,
        delivers:
          providerDelivers(existing.provider) &&
          existing.status !== "failed" &&
          existing.status !== "suppressed",
        duplicate: true,
      };
    }
  } else {
    [inserted] = await tx
      .insert(mailDeliveries)
      .values({
        id: deliveryId,
        senderId: sender?.id,
        purpose,
        provider: route.provider,
        recipient,
        subject: prepared.subject,
        requestedBy: options.requestedBy ?? "system",
      })
      .returning({ id: mailDeliveries.id });
  }
  if (!inserted) {
    throw new Error("The queued mail delivery could not be created.");
  }

  const finalMessage: StagedMessage = {
    ...prepared,
    from:
      prepared.from ??
      (sender
        ? sender.displayName
          ? `${sender.displayName} <${sender.email}>`
          : sender.email
        : undefined),
  };
  const serialized = JSON.stringify(finalMessage);
  if (Buffer.byteLength(serialized, "utf8") > 5_000_000) {
    throw new ServiceError("validation", "That mail message is too large to queue safely.");
  }
  await tx.insert(mailOutbox).values({
    deliveryId: inserted.id,
    encryptedMessage: encryptMailOutbox(serialized, inserted.id),
  });
  await enqueueJob(
    tx,
    "core.deliverMail",
    { deliveryId: inserted.id },
    { idempotencyKey: `mail-delivery:${inserted.id}` },
  );
  return {
    id: inserted.id,
    provider: route.provider,
    providerRef: null,
    delivers: route.delivers,
    duplicate: false,
  };
}

function safeDeliveryError(error: unknown): string {
  return error instanceof ServiceError || error instanceof MailAdapterError
    ? error.message.slice(0, 500)
    : "The mail provider could not submit this message.";
}

async function finishQueuedMail(
  deliveryId: string,
  values: Partial<typeof mailDeliveries.$inferInsert>,
): Promise<void> {
  await db().transaction(async (tx) => {
    await tx
      .update(mailDeliveries)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(mailDeliveries.id, deliveryId));
    await tx.delete(mailOutbox).where(eq(mailOutbox.deliveryId, deliveryId));
  });
}

/** Snapshot, provider call, apply: no database transaction spans the call. */
export async function deliverQueuedMail(deliveryId: string): Promise<{
  status: "missing" | "submitted" | "failed" | "suppressed";
}> {
  const [queued] = await db()
    .select({
      delivery: mailDeliveries,
      encryptedMessage: mailOutbox.encryptedMessage,
    })
    .from(mailOutbox)
    .innerJoin(mailDeliveries, eq(mailDeliveries.id, mailOutbox.deliveryId))
    .where(eq(mailOutbox.deliveryId, deliveryId))
    .limit(1);
  if (!queued) return { status: "missing" };
  if (!["queued", "failed"].includes(queued.delivery.status)) {
    await db().delete(mailOutbox).where(eq(mailOutbox.deliveryId, deliveryId));
    return { status: "missing" };
  }

  let message: StagedMessage;
  try {
    message = stagedMessage.parse(
      JSON.parse(decryptMailOutbox(queued.encryptedMessage, deliveryId)) as unknown,
    );
  } catch {
    await finishQueuedMail(deliveryId, {
      status: "failed",
      lastError: "The encrypted mail payload could not be read safely.",
    });
    return { status: "failed" };
  }

  const [suppressed] = await db()
    .select({ reason: mailSuppressions.reason })
    .from(mailSuppressions)
    .where(
      and(
        eq(mailSuppressions.email, queued.delivery.recipient),
        eq(mailSuppressions.active, true),
      ),
    )
    .limit(1);
  if (suppressed) {
    await finishQueuedMail(deliveryId, {
      status: "suppressed",
      lastError: `Suppressed after a ${suppressed.reason.replace("_", " ")}.`,
    });
    return { status: "suppressed" };
  }

  await db()
    .update(mailDeliveries)
    .set({ attempts: sql`${mailDeliveries.attempts} + 1`, updatedAt: new Date() })
    .where(eq(mailDeliveries.id, deliveryId));

  try {
    const sender = queued.delivery.senderId
      ? await getSender(db() as unknown as Tx, queued.delivery.senderId)
      : undefined;
    const adapter = sender
      ? await adapterFor(sender)
      : providerForPurpose(queued.delivery.purpose);
    if (adapter.id !== queued.delivery.provider) {
      throw new MailAdapterError(
        "The configured mail route changed after this message was queued.",
      );
    }
    const result = await adapter.send({ ...message, deliveryId });
    await finishQueuedMail(deliveryId, {
      providerRef: result.providerRef,
      status: adapter.delivers ? "submitted" : "failed",
      submittedAt: adapter.delivers ? new Date() : null,
      lastError: adapter.delivers ? null : "The configured adapter does not deliver.",
    });
    return { status: adapter.delivers ? "submitted" : "failed" };
  } catch (error) {
    const retryable =
      error instanceof MailAdapterError
        ? error.retryable
        : !(error instanceof ServiceError);
    await db()
      .update(mailDeliveries)
      .set({
        status: retryable ? "queued" : "failed",
        lastError: safeDeliveryError(error),
        updatedAt: new Date(),
      })
      .where(eq(mailDeliveries.id, deliveryId));
    if (retryable) throw error;
    await db().delete(mailOutbox).where(eq(mailOutbox.deliveryId, deliveryId));
    return { status: "failed" };
  }
}

export async function pruneExpiredMailOutbox(): Promise<number> {
  const expired = await db().transaction(async (tx) => {
    const rows = await tx
      .delete(mailOutbox)
      .where(sql`${mailOutbox.createdAt} < now() - interval '30 days'`)
      .returning({ deliveryId: mailOutbox.deliveryId });
    if (rows.length > 0) {
      await tx
        .update(mailDeliveries)
        .set({
          status: "failed",
          lastError: "Queued mail expired before it could be delivered.",
          updatedAt: new Date(),
        })
        .where(inArray(mailDeliveries.id, rows.map((row) => row.deliveryId)));
    }
    return rows;
  });
  return expired.length;
}

export const mailStatus = defineService({
  name: "mail.status",
  summary: "Mail senders, recent delivery evidence, and active suppressions.",
  kind: "query",
  permission: "scoped",
  input: z.object({ limit: z.number().int().min(1).max(100).default(25) }),
  output: z.object({
    configuration: mailConfiguration,
    senders: listed(
      row({
        id: uuid,
        purpose: z.enum(["transactional", "bulk"]),
        provider: z.enum([
          "gmail",
          "outlook",
          "smtp",
          "console",
          "resend",
          "postmark",
          "ses",
        ]),
        email: z.string(),
        displayName: z.string().nullable(),
        verificationStatus: z.enum(["pending", "verified", "failed"]),
        status: z.enum(["active", "paused", "needs_attention"]),
        isDefault: z.boolean(),
        lastVerifiedAt: timestamp.nullable(),
        lastError: z.string().nullable(),
        createdAt: timestamp,
        accountStatus: z
          .enum(["active", "needs_reconnect", "revoked"])
          .nullable(),
        capabilityEnabled: z.boolean().nullable(),
      }),
    ),
    deliveries: listed(mailDeliveryRow),
    suppressions: listed(mailSuppressionRow),
  }),
  handler: async (input, ctx) => {
    const [senders, deliveries, suppressions] = await Promise.all([
      ctx.tx
        .select({
          id: mailSenders.id,
          purpose: mailSenders.purpose,
          provider: mailSenders.provider,
          email: mailSenders.email,
          displayName: mailSenders.displayName,
          verificationStatus: mailSenders.verificationStatus,
          status: mailSenders.status,
          isDefault: mailSenders.isDefault,
          lastVerifiedAt: mailSenders.lastVerifiedAt,
          lastError: mailSenders.lastError,
          createdAt: mailSenders.createdAt,
          accountStatus: connectedAccounts.status,
          capabilityEnabled: connectionCapabilities.enabled,
        })
        .from(mailSenders)
        .leftJoin(
          connectedAccounts,
          eq(connectedAccounts.id, mailSenders.connectedAccountId),
        )
        .leftJoin(
          connectionCapabilities,
          and(
            eq(
              connectionCapabilities.connectedAccountId,
              connectedAccounts.id,
            ),
            eq(connectionCapabilities.capability, "mail_send"),
          ),
        )
        .orderBy(mailSenders.purpose, desc(mailSenders.createdAt)),
      ctx.tx
        .select()
        .from(mailDeliveries)
        .orderBy(desc(mailDeliveries.createdAt))
        .limit(input.limit),
      ctx.tx
        .select()
        .from(mailSuppressions)
        .where(eq(mailSuppressions.active, true))
        .orderBy(desc(mailSuppressions.createdAt))
        .limit(input.limit),
    ]);
    return {
      configuration: mailConfigurationStatus(),
      senders,
      deliveries,
      suppressions,
    };
  },
});

export const registerMailSender = defineService({
  name: "mail.registerSender",
  summary: "Register an environment-backed mail sender for this instance.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  agentCallable: false,
  input: z.object({
    purpose: z.enum(["transactional", "bulk"]),
    provider: senderProvider,
    email: address,
    displayName: z.string().trim().min(1).max(200).optional(),
    providerIdentity: z.string().trim().min(1).max(300).optional(),
  }),
  output: mailSenderRow,
  handler: async (input, ctx) => {
    refuseAgent(ctx.actor, "register");
    const configured = providerForPurpose(input.purpose);
    if (configured.id !== input.provider) {
      throw new ServiceError(
        "validation",
        `This deployment is configured for ${configured.id}, not ${input.provider}.`,
      );
    }
    if (input.purpose === "bulk" && !["resend", "postmark", "ses"].includes(input.provider)) {
      throw new ServiceError("validation", "Bulk mail requires Resend, Postmark, or Amazon SES.");
    }
    if (input.purpose === "transactional" && input.provider !== "smtp") {
      throw new ServiceError("validation", "Connect Gmail or Microsoft through OAuth instead.");
    }
    const configuration = mailConfigurationStatus();
    const configuredAddress =
      input.purpose === "transactional"
        ? configuration.transactional.fromAddress
        : configuration.bulk.fromAddress;
    if (!configuredAddress || input.email !== configuredAddress) {
      throw new ServiceError(
        "validation",
        `Register the exact sender address configured in ${input.purpose === "transactional" ? "MAIL_FROM" : "MAIL_BULK_FROM"}.`,
      );
    }
    await lockDefaultSender(ctx.tx, input.purpose);
    const [existingDefault] = await ctx.tx
      .select({ id: mailSenders.id })
      .from(mailSenders)
      .where(and(eq(mailSenders.purpose, input.purpose), eq(mailSenders.isDefault, true)))
      .limit(1);
    const [sender] = await ctx.tx
      .insert(mailSenders)
      .values({
        ...input,
        verificationStatus: input.purpose === "transactional" ? "verified" : "pending",
        verificationDetail:
          input.provider === "smtp"
            ? {
                transportConfigured: true,
                dnsOwnershipVerified: false,
              }
            : {},
        isDefault: !existingDefault && input.purpose === "transactional",
        createdBy: ctx.actor.kind === "user" ? ctx.actor.userId : null,
      })
      .onConflictDoUpdate({
        target: [mailSenders.purpose, mailSenders.provider, mailSenders.email],
        set: {
          displayName: input.displayName,
          providerIdentity: input.providerIdentity,
          status: "active",
          lastError: null,
        },
      })
      .returning();
    ctx.setSubject("mail_sender", sender!.id);
    ctx.queueEvent("mail.senderRegistered", {
      id: sender!.id,
      purpose: sender!.purpose,
      provider: sender!.provider,
      email: sender!.email,
    });
    return sender!;
  },
});

export const verifyMailSender = defineService({
  name: "mail.verifySender",
  summary: "Queue a check of whether a bulk sender identity is verified.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  agentCallable: false,
  input: z.object({ id: z.uuid() }),
  output: mailSenderRow,
  handler: async (input, ctx) => {
    refuseAgent(ctx.actor, "verify");
    const sender = await getSender(ctx.tx, input.id);
    if (sender.purpose !== "bulk") {
      throw new ServiceError("validation", "OAuth and SMTP senders do not use bulk identity verification.");
    }
    const adapter = providerForPurpose("bulk");
    if (adapter.id !== sender.provider || !adapter.verifySender) {
      throw new ServiceError("conflict", "That provider cannot verify this sender here.");
    }
    const requestId = randomUUID();
    const [updated] = await ctx.tx
      .update(mailSenders)
      .set({
        verificationStatus: "pending",
        verificationDetail: { requestId },
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(mailSenders.id, input.id))
      .returning();
    await ctx.queueJob(
      "core.verifyMailSender",
      { senderId: input.id, requestId },
      { idempotencyKey: `mail-sender-verification:${requestId}` },
    );
    ctx.setSubject("mail_sender", input.id);
    ctx.queueEvent("mail.senderVerificationQueued", {
      id: input.id,
      requestId,
    });
    return updated!;
  },
});

const senderVerificationResult = z.object({
  status: z.enum(["pending", "verified", "failed"]),
  detail: z.record(z.string(), z.unknown()),
  message: z.string().max(500).optional(),
});

/** Apply provider evidence only if it belongs to the latest queued check. */
export const applyMailSenderVerification = defineService({
  name: "mail.applySenderVerification",
  summary: "Apply a completed provider sender-verification check.",
  kind: "mutation",
  permission: "system",
  input: z.object({
    id: uuid,
    requestId: uuid,
    result: senderVerificationResult.nullable(),
    error: z.string().max(500).nullable(),
  }),
  output: z.object({ applied: z.boolean() }),
  handler: async (input, ctx) => {
    const pendingRequest = sql`${mailSenders.verificationDetail}->>'requestId' = ${input.requestId}`;
    const [current] = await ctx.tx
      .select({ status: mailSenders.status })
      .from(mailSenders)
      .where(
        and(
          eq(mailSenders.id, input.id),
          eq(mailSenders.verificationStatus, "pending"),
          pendingRequest,
        ),
      )
      .limit(1);
    if (!current) return { applied: false };

    if (!input.result) {
      await ctx.tx
        .update(mailSenders)
        .set({ lastError: input.error, updatedAt: new Date() })
        .where(and(eq(mailSenders.id, input.id), pendingRequest));
      return { applied: true };
    }

    const [updated] = await ctx.tx
      .update(mailSenders)
      .set({
        verificationStatus: input.result.status,
        verificationDetail: input.result.detail,
        lastVerifiedAt: new Date(),
        lastError: input.result.message ?? null,
        status:
          input.result.status === "failed"
            ? "needs_attention"
            : current.status === "needs_attention"
              ? "active"
              : current.status,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mailSenders.id, input.id),
          eq(mailSenders.verificationStatus, "pending"),
          pendingRequest,
        ),
      )
      .returning({ id: mailSenders.id });
    if (!updated) return { applied: false };
    ctx.setSubject("mail_sender", input.id);
    ctx.queueEvent("mail.senderVerified", {
      id: input.id,
      status: input.result.status,
    });
    return { applied: true };
  },
});

/** Snapshot, provider call, apply: verification never holds a DB transaction. */
export async function runMailSenderVerification(
  senderId: string,
  requestId: string,
): Promise<{ applied: boolean }> {
  let sender: SenderRow;
  try {
    sender = await getSender(db() as unknown as Tx, senderId);
  } catch (error) {
    if (error instanceof ServiceError && error.code === "not_found") {
      return { applied: false };
    }
    throw error;
  }
  if (
    sender.purpose !== "bulk" ||
    sender.verificationStatus !== "pending" ||
    !sender.verificationDetail ||
    typeof sender.verificationDetail !== "object" ||
    (sender.verificationDetail as Record<string, unknown>).requestId !== requestId
  ) {
    return { applied: false };
  }
  const adapter = providerForPurpose("bulk");
  if (adapter.id !== sender.provider || !adapter.verifySender) {
    return applyMailSenderVerification.call(
      {
        id: senderId,
        requestId,
        result: {
          status: "failed",
          detail: {},
          message: "That provider can no longer verify this sender here.",
        },
        error: null,
      },
      { kind: "system" },
    );
  }

  let result: SenderVerification;
  try {
    result = await adapter.verifySender({
      email: sender.email,
      providerIdentity: sender.providerIdentity ?? undefined,
    });
  } catch (error) {
    const message = safeDeliveryError(error);
    const retryable = !(error instanceof MailAdapterError) || error.retryable;
    if (retryable) {
      await applyMailSenderVerification.call(
        { id: senderId, requestId, result: null, error: message },
        { kind: "system" },
      );
      throw error;
    }
    result = { status: "failed", detail: {}, message };
  }
  return applyMailSenderVerification.call(
    { id: senderId, requestId, result, error: null },
    { kind: "system" },
  );
}

export const setDefaultMailSender = defineService({
  name: "mail.setDefaultSender",
  summary: "Choose the sender used for one mail purpose.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  agentCallable: false,
  input: z.object({ id: z.uuid() }),
  output: mailSenderRow,
  handler: async (input, ctx) => {
    refuseAgent(ctx.actor, "change");
    const sender = await getSender(ctx.tx, input.id);
    if (sender.verificationStatus !== "verified" || sender.status !== "active") {
      throw new ServiceError("conflict", "Only an active, verified sender can be the default.");
    }
    if (sender.provider === "console") {
      throw new ServiceError(
        "conflict",
        "A non-delivering development adapter cannot be the default sender.",
      );
    }
    if (
      (sender.provider === "gmail" || sender.provider === "outlook") &&
      (sender.accountStatus !== "active" || !sender.capabilityEnabled)
    ) {
      throw new ServiceError(
        "conflict",
        "Reconnect this mailbox and enable mail-send permission before selecting it.",
      );
    }
    await lockDefaultSender(ctx.tx, sender.purpose);
    await ctx.tx
      .update(mailSenders)
      .set({ isDefault: false })
      .where(eq(mailSenders.purpose, sender.purpose));
    const [updated] = await ctx.tx
      .update(mailSenders)
      .set({ isDefault: true })
      .where(
        and(
          eq(mailSenders.id, input.id),
          eq(mailSenders.status, "active"),
          eq(mailSenders.verificationStatus, "verified"),
        ),
      )
      .returning();
    if (!updated) {
      throw new ServiceError(
        "conflict",
        "That sender changed while it was being selected. Recheck it and try again.",
      );
    }
    ctx.setSubject("mail_sender", input.id);
    ctx.queueEvent("mail.defaultSenderChanged", {
      id: input.id,
      purpose: sender.purpose,
    });
    return updated;
  },
});

export const updateMailSender = defineService({
  name: "mail.updateSender",
  summary: "Pause or reactivate a mail sender.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  agentCallable: false,
  input: z.object({ id: z.uuid(), status: z.enum(["active", "paused"]) }),
  output: mailSenderRow,
  handler: async (input, ctx) => {
    refuseAgent(ctx.actor, "change");
    const [row] = await ctx.tx
      .update(mailSenders)
      .set({ status: input.status, isDefault: input.status === "paused" ? false : undefined })
      .where(eq(mailSenders.id, input.id))
      .returning();
    if (!row) throw new ServiceError("not_found", "No such mail sender.");
    ctx.setSubject("mail_sender", input.id);
    ctx.queueEvent("mail.senderUpdated", { id: input.id, status: input.status });
    return row;
  },
});

export const testMailSender = defineService({
  name: "mail.testSend",
  summary: "Send a plain test message from one sender to the signed-in person.",
  kind: "mutation",
  permission: "scoped",
  rateLimit: {
    limit: 5,
    windowSeconds: 15 * 60,
    subject: () => "mail-test",
    message: "Too many mail tests were sent. Wait a few minutes and try again.",
  },
  input: z.object({ id: z.uuid() }),
  output: mailSendResult,
  handler: async (input, ctx) => {
    const actor = ctx.actor;
    refuseAgent(actor, "test");
    if (actor.kind !== "user") throw new ServiceError("permission", "Sign in to test mail.");
    const [owner] = await ctx.tx
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, actor.userId))
      .limit(1);
    if (!owner) throw new ServiceError("not_found", "Your user account no longer exists.");
    const sender = await getSender(ctx.tx, input.id);
    const result = await sendMail(
      ctx.tx,
      {
        to: owner.email,
        subject: "Freeholder mail test",
        text:
          `Freeholder submitted this test through the configured ${sender.provider} sender ${sender.email}. ` +
          "Receiving it confirms that this route delivered to your inbox; submission alone does not prove DNS ownership or inbox placement.",
      },
      {
        purpose: sender.purpose,
        senderId: sender.id,
        requestedBy: actorString(actor),
      },
    );
    ctx.setSubject("mail_delivery", result.id);
    ctx.queueEvent("mail.testSent", {
      id: result.id,
      senderId: sender.id,
      delivers: result.delivers,
    });
    return result;
  },
});

export const releaseMailSuppression = defineService({
  name: "mail.releaseSuppression",
  summary: "Release an address after its correction or explicit verification.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  agentCallable: false,
  input: z.object({ email: address, confirmation: z.string() }),
  output: mailSuppressionRow,
  handler: async (input, ctx) => {
    refuseAgent(ctx.actor, "release");
    if (input.confirmation !== input.email) {
      throw new ServiceError("validation", "Type the exact email address to release it.");
    }
    const [row] = await ctx.tx
      .update(mailSuppressions)
      .set({
        active: false,
        releasedAt: new Date(),
        releasedBy: ctx.actor.kind === "user" ? ctx.actor.userId : null,
      })
      .where(and(eq(mailSuppressions.email, input.email), eq(mailSuppressions.active, true)))
      .returning();
    if (!row) throw new ServiceError("not_found", "That address is not suppressed.");
    ctx.setSubject("mail_suppression", input.email);
    ctx.queueEvent("mail.suppressionReleased", { email: input.email });
    return row;
  },
});

export interface NormalizedProviderEvent {
  provider: "resend" | "postmark" | "ses";
  externalEventId: string;
  providerRef?: string;
  recipient: string;
  eventType:
    | "submitted"
    | "delivered"
    | "delayed"
    | "soft_bounce"
    | "hard_bounce"
    | "complaint"
    | "suppressed"
    | "failed";
  detail?: string;
  rawDigest: string;
  occurredAt: string;
}

export const recordMailProviderEvent = defineService({
  name: "mail.recordProviderEvent",
  summary: "Record one authenticated provider delivery event.",
  kind: "mutation",
  permission: "system",
  input: z.object({
    provider: z.enum(["resend", "postmark", "ses"]),
    externalEventId: z.string().min(1).max(500),
    providerRef: z.string().max(500).optional(),
    recipient: address,
    eventType: z.enum([
      "submitted",
      "delivered",
      "delayed",
      "soft_bounce",
      "hard_bounce",
      "complaint",
      "suppressed",
      "failed",
    ]),
    detail: z.string().max(1000).optional(),
    rawDigest: z.string().length(64),
    occurredAt: z.iso.datetime(),
  }),
  output: z.union([
    z.object({ duplicate: z.literal(true) }),
    z.object({ id: uuid, duplicate: z.literal(false) }),
  ]),
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "system") {
      throw new ServiceError("permission", "Only an authenticated provider webhook may record this event.");
    }
    const [delivery] = input.providerRef
      ? await ctx.tx
          .select({ id: mailDeliveries.id })
          .from(mailDeliveries)
          .where(
            and(
              eq(mailDeliveries.provider, input.provider),
              eq(mailDeliveries.providerRef, input.providerRef),
            ),
          )
          .limit(1)
      : [];
    const occurredAt = new Date(input.occurredAt);
    const [event] = await ctx.tx
      .insert(mailProviderEvents)
      .values({
        ...input,
        deliveryId: delivery?.id,
        occurredAt,
      })
      .onConflictDoNothing()
      .returning({ id: mailProviderEvents.id });
    if (!event) {
      return { duplicate: true } as const;
    }
    const status =
      input.eventType === "delivered"
        ? "delivered"
        : input.eventType === "hard_bounce" || input.eventType === "soft_bounce"
          ? "bounced"
          : input.eventType === "complaint"
            ? "complained"
            : input.eventType === "suppressed"
              ? "suppressed"
              : input.eventType === "failed"
                ? "failed"
                : input.eventType === "submitted"
                  ? "submitted"
                  : undefined;
    if (delivery && status) {
      const allowedCurrent =
        status === "submitted"
          ? (["queued", "submitted"] as const)
          : status === "delivered"
            ? (["queued", "submitted", "delivered"] as const)
            : status === "failed"
              ? (["queued", "submitted", "failed"] as const)
              : status === "bounced"
                ? (["queued", "submitted", "delivered", "failed", "bounced"] as const)
                : status === "complained"
                  ? ([
                      "queued",
                      "submitted",
                      "delivered",
                      "failed",
                      "bounced",
                      "complained",
                    ] as const)
                  : ([
                      "queued",
                      "submitted",
                      "delivered",
                      "failed",
                      "bounced",
                      "complained",
                      "suppressed",
                    ] as const);
      await ctx.tx
        .update(mailDeliveries)
        .set({
          status,
          lastError: ["bounced", "complained", "suppressed", "failed"].includes(status)
            ? input.detail ?? input.eventType
            : null,
          deliveredAt: status === "delivered" ? occurredAt : undefined,
          providerStatusAt: occurredAt,
        })
        .where(
          and(
            eq(mailDeliveries.id, delivery.id),
            inArray(mailDeliveries.status, allowedCurrent),
            or(
              isNull(mailDeliveries.providerStatusAt),
              lte(mailDeliveries.providerStatusAt, occurredAt),
            ),
          ),
        );
    }
    if (["hard_bounce", "complaint", "suppressed"].includes(input.eventType)) {
      const reason =
        input.eventType === "hard_bounce"
          ? "hard_bounce"
          : input.eventType === "complaint"
            ? "complaint"
            : "provider";
      await ctx.tx
        .insert(mailSuppressions)
        .values({
          email: input.recipient,
          reason,
          provider: input.provider,
          sourceEventId: event.id,
          detail: input.detail,
        })
        .onConflictDoUpdate({
          target: mailSuppressions.email,
          set: {
            reason,
            provider: input.provider,
            sourceEventId: event.id,
            detail: input.detail,
            active: true,
            releasedAt: null,
            releasedBy: null,
          },
          setWhere: or(
            eq(mailSuppressions.active, true),
            isNull(mailSuppressions.releasedAt),
            lte(mailSuppressions.releasedAt, occurredAt),
          ),
        });
    }
    ctx.setSubject("mail_provider_event", event.id);
    ctx.queueEvent("mail.deliveryUpdated", {
      eventId: event.id,
      deliveryId: delivery?.id,
      type: input.eventType,
      recipient: input.recipient,
    });
    return { id: event.id, duplicate: false } as const;
  },
});

export default [
  mailStatus,
  registerMailSender,
  verifyMailSender,
  applyMailSenderVerification,
  setDefaultMailSender,
  updateMailSender,
  testMailSender,
  releaseMailSuppression,
  recordMailProviderEvent,
];
