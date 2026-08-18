// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Staff invitation lifecycle (MASTER.md §43 C1.02).
//
// An invitation is a short-lived bearer credential. The raw token exists only
// in the email; the database and audit trail see its SHA-256 hash or a redacted
// input. Creating the account and retiring the credential share one
// transaction, so an invitation can never be half accepted.
import { createHash, randomBytes } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { sendMail } from "@/core/mail/service";
import {
  roleGrants,
  roles,
  staffInvitations,
  users,
} from "@/core/auth/schema";
import { hashPassword } from "@/core/auth/passwords";
import { isUniqueViolation } from "@/core/db";
import { auditLog } from "@/core/events/schema";
import { env } from "@/core/env";
import { listed, row, timestamp, uuid } from "@/core/contract";
import {
  actorString,
  defineService,
  ServiceError,
  type Tx,
} from "@/core/service";
import { businessProfile } from "@/core/settings/schema";

const DEFAULT_LIFETIME_DAYS = 7;
const emailAddress = z.string().trim().email().toLowerCase().max(320);
const invitationId = z.string().uuid();
const roleKey = z.string().min(2).max(60);
const invitationDelivery = row({
  id: uuid,
  expiresAt: timestamp,
  delivery: z.enum(["sent", "logged"]),
});
const inspectInvitationOutput = z.discriminatedUnion("status", [
  z.object({ status: z.literal("invalid") }),
  z.object({ status: z.literal("unavailable"), email: z.string() }),
  z.object({ status: z.literal("accepted"), email: z.string() }),
  z.object({ status: z.literal("revoked"), email: z.string() }),
  z.object({ status: z.literal("expired"), email: z.string() }),
  z.object({
    status: z.literal("pending"),
    email: z.string(),
    roleName: z.string(),
    expiresAt: timestamp,
  }),
]);

type StoredStatus = "pending" | "accepted" | "revoked" | "expired";
type PresentedStatus = StoredStatus | "invalid" | "unavailable";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function expiry(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function effectiveStatus(
  status: StoredStatus,
  expiresAt: Date,
): StoredStatus {
  return status === "pending" && expiresAt.getTime() <= Date.now()
    ? "expired"
    : status;
}

async function findStaffRole(
  tx: Tx,
  key: string,
): Promise<{ key: string; name: string } | undefined> {
  const [role] = await tx
    .select({ key: roles.key, name: roles.name, assignable: roles.assignable })
    .from(roles)
    .where(eq(roles.key, key))
    .limit(1);
  if (!role?.assignable) return undefined;

  const grants = await tx
    .select({ module: roleGrants.module })
    .from(roleGrants)
    .where(eq(roleGrants.roleKey, key));
  if (!grants.some((grant) => grant.module === "*" || grant.module === "admin")) {
    return undefined;
  }
  return { key: role.key, name: role.name };
}

async function requireStaffRole(tx: Tx, key: string) {
  const role = await findStaffRole(tx, key);
  if (!role) {
    throw new ServiceError(
      "validation",
      "Choose an assignable role that can enter the admin area.",
    );
  }
  return role;
}

async function expireStaleForEmail(tx: Tx, email: string): Promise<void> {
  await tx
    .update(staffInvitations)
    .set({ status: "expired", updatedAt: new Date() })
    .where(
      and(
        eq(staffInvitations.email, email),
        eq(staffInvitations.status, "pending"),
        lt(staffInvitations.expiresAt, new Date()),
      ),
    );
}

function invitationUrl(token: string): string {
  const origin = env().APP_URL.replace(/\/+$/, "");
  return `${origin}/invite?token=${encodeURIComponent(token)}`;
}

async function deliver(
  tx: Tx,
  input: {
    email: string;
    roleName: string;
    token: string;
    expiresAt: Date;
    idempotencyKey: string;
  },
) {
  const [business] = await tx
    .select({ name: businessProfile.name })
    .from(businessProfile)
    .limit(1);
  const site = business?.name ?? "this Freeholder site";
  const result = await sendMail(tx, {
    to: input.email,
    subject: `You are invited to ${site}`,
    text: [
      `You have been invited to help manage ${site} as ${input.roleName}.`,
      "",
      "Choose your password and accept the invitation here:",
      invitationUrl(input.token),
      "",
      `This private link expires ${input.expiresAt.toISOString()}.`,
      "If you were not expecting it, you can ignore this message.",
    ].join("\n"),
  }, {
    requestedBy: "system",
    idempotencyKey: input.idempotencyKey,
  });
  return {
    adapter: result.provider,
    delivers: result.delivers,
    providerRef: result.providerRef,
  };
}

export const listInvitationRoles = defineService({
  name: "invitations.roles",
  summary: "List assignable roles that can be used for a staff invitation.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(
    row({
      key: z.string(),
      name: z.string(),
      description: z.string(),
    }),
  ),
  handler: async (_input, ctx) => {
    const [catalogue, grants] = await Promise.all([
      ctx.tx
        .select({ key: roles.key, name: roles.name, description: roles.description })
        .from(roles)
        .where(eq(roles.assignable, true))
        .orderBy(asc(roles.name)),
      ctx.tx
        .select({ roleKey: roleGrants.roleKey, module: roleGrants.module })
        .from(roleGrants),
    ]);
    return catalogue.filter((role) =>
      grants.some(
        (grant) =>
          grant.roleKey === role.key &&
          (grant.module === "*" || grant.module === "admin"),
      ),
    );
  },
});

export const listInvitations = defineService({
  name: "invitations.list",
  summary: "List staff invitations with delivery and audit history.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(
    row({
      id: uuid,
      email: z.string(),
      roleKey: z.string(),
      roleName: z.string(),
      status: z.enum(["pending", "accepted", "revoked", "expired"]),
      expiresAt: timestamp,
      createdBy: z.string(),
      sendCount: z.number().int(),
      lastAttemptedAt: timestamp,
      lastSentAt: timestamp.nullable(),
      deliveryAdapter: z.string().nullable(),
      acceptedAt: timestamp.nullable(),
      revokedAt: timestamp.nullable(),
      createdAt: timestamp,
      history: listed(
        row({
          action: z.string(),
          actor: z.string(),
          at: timestamp,
        }),
      ),
    }),
  ),
  handler: async (_input, ctx) => {
    const [rows, history] = await Promise.all([
      ctx.tx
        .select({
          id: staffInvitations.id,
          email: staffInvitations.email,
          roleKey: staffInvitations.roleKey,
          roleName: roles.name,
          status: staffInvitations.status,
          expiresAt: staffInvitations.expiresAt,
          createdBy: staffInvitations.createdBy,
          sendCount: staffInvitations.sendCount,
          lastAttemptedAt: staffInvitations.lastAttemptedAt,
          lastSentAt: staffInvitations.lastSentAt,
          deliveryAdapter: staffInvitations.deliveryAdapter,
          acceptedAt: staffInvitations.acceptedAt,
          revokedAt: staffInvitations.revokedAt,
          createdAt: staffInvitations.createdAt,
        })
        .from(staffInvitations)
        .leftJoin(roles, eq(staffInvitations.roleKey, roles.key))
        .orderBy(desc(staffInvitations.createdAt)),
      ctx.tx
        .select({
          subjectId: auditLog.subjectId,
          action: auditLog.action,
          actor: auditLog.actor,
          at: auditLog.at,
        })
        .from(auditLog)
        .where(eq(auditLog.subjectType, "staff_invitation"))
        .orderBy(desc(auditLog.at)),
    ]);

    return rows.map((row) => ({
      ...row,
      roleName: row.roleName ?? row.roleKey,
      status: effectiveStatus(row.status, row.expiresAt),
      history: history
        .filter((event) => event.subjectId === row.id)
        .map(({ subjectId: _subjectId, ...event }) => event),
    }));
  },
});

export const createInvitation = defineService({
  name: "invitations.create",
  summary: "Invite a new staff member into an assignable admin role.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({
    email: emailAddress,
    roleKey,
    expiresInDays: z.number().int().min(1).max(30).default(DEFAULT_LIFETIME_DAYS),
  }),
  output: invitationDelivery,
  handler: async (input, ctx) => {
    const role = await requireStaffRole(ctx.tx, input.roleKey);
    await expireStaleForEmail(ctx.tx, input.email);

    const [account] = await ctx.tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);
    if (account) {
      throw new ServiceError(
        "conflict",
        "That email address already has an account. Change its role instead.",
      );
    }

    const [pending] = await ctx.tx
      .select({ id: staffInvitations.id })
      .from(staffInvitations)
      .where(
        and(
          eq(staffInvitations.email, input.email),
          eq(staffInvitations.status, "pending"),
        ),
      )
      .limit(1);
    if (pending) {
      throw new ServiceError(
        "conflict",
        "That address already has a pending invitation. Resend or revoke it.",
      );
    }

    const token = newToken();
    const expiresAt = expiry(input.expiresInDays);
    const attemptedAt = new Date();
    const [row] = await ctx.tx
      .insert(staffInvitations)
      .values({
        email: input.email,
        roleKey: role.key,
        tokenHash: hashToken(token),
        expiresAt,
        createdBy: actorString(ctx.actor),
        lastAttemptedAt: attemptedAt,
      })
      .returning({ id: staffInvitations.id })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new ServiceError(
            "conflict",
            "That address already has a pending invitation.",
          );
        }
        throw error;
      });

    const delivery = await deliver(ctx.tx, {
      email: input.email,
      roleName: role.name,
      token,
      expiresAt,
      idempotencyKey: `staff-invitation:${row!.id}:send:1`,
    });
    await ctx.tx
      .update(staffInvitations)
      .set({
        lastSentAt: delivery.delivers ? attemptedAt : null,
        deliveryAdapter: delivery.adapter,
        providerRef: delivery.providerRef,
        updatedAt: new Date(),
      })
      .where(eq(staffInvitations.id, row!.id));

    ctx.setSubject("staff_invitation", row!.id);
    ctx.queueEvent("staffInvitation.created", {
      invitationId: row!.id,
      email: input.email,
      roleKey: role.key,
      delivers: delivery.delivers,
    });
    return {
      id: row!.id,
      expiresAt,
      delivery: delivery.delivers ? ("sent" as const) : ("logged" as const),
    };
  },
});

export const resendInvitation = defineService({
  name: "invitations.resend",
  summary: "Rotate and resend a pending or expired staff invitation.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({ id: invitationId }),
  output: invitationDelivery,
  handler: async (input, ctx) => {
    const [invitation] = await ctx.tx
      .select()
      .from(staffInvitations)
      .where(eq(staffInvitations.id, input.id))
      .limit(1);
    if (!invitation) throw new ServiceError("not_found", "Invitation not found.");
    if (invitation.status === "accepted" || invitation.status === "revoked") {
      throw new ServiceError(
        "conflict",
        "Accepted or revoked invitations cannot be resent. Create a new one.",
      );
    }

    const role = await requireStaffRole(ctx.tx, invitation.roleKey);
    await expireStaleForEmail(ctx.tx, invitation.email);
    const [other] = await ctx.tx
      .select({ id: staffInvitations.id })
      .from(staffInvitations)
      .where(
        and(
          eq(staffInvitations.email, invitation.email),
          eq(staffInvitations.status, "pending"),
          ne(staffInvitations.id, invitation.id),
        ),
      )
      .limit(1);
    if (other) {
      throw new ServiceError(
        "conflict",
        "A newer pending invitation exists for that address.",
      );
    }

    const token = newToken();
    const expiresAt = expiry(DEFAULT_LIFETIME_DAYS);
    const attemptedAt = new Date();
    const [rotated] = await ctx.tx
      .update(staffInvitations)
      .set({
        tokenHash: hashToken(token),
        status: "pending",
        expiresAt,
        sendCount: sql`${staffInvitations.sendCount} + 1`,
        lastAttemptedAt: attemptedAt,
        lastSentAt: null,
        deliveryAdapter: null,
        providerRef: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(staffInvitations.id, invitation.id),
          eq(staffInvitations.tokenHash, invitation.tokenHash),
          or(
            eq(staffInvitations.status, "pending"),
            eq(staffInvitations.status, "expired"),
          ),
        ),
      )
      .returning({ id: staffInvitations.id });
    if (!rotated) {
      throw new ServiceError(
        "conflict",
        "That invitation changed while it was being resent. Reload and try again.",
      );
    }

    const delivery = await deliver(ctx.tx, {
      email: invitation.email,
      roleName: role.name,
      token,
      expiresAt,
      idempotencyKey: `staff-invitation:${invitation.id}:send:${invitation.sendCount + 1}`,
    });
    await ctx.tx
      .update(staffInvitations)
      .set({
        lastSentAt: delivery.delivers ? attemptedAt : null,
        deliveryAdapter: delivery.adapter,
        providerRef: delivery.providerRef,
        updatedAt: new Date(),
      })
      .where(eq(staffInvitations.id, invitation.id));

    ctx.setSubject("staff_invitation", invitation.id);
    ctx.queueEvent("staffInvitation.resent", {
      invitationId: invitation.id,
      delivers: delivery.delivers,
    });
    return {
      id: invitation.id,
      expiresAt,
      delivery: delivery.delivers ? ("sent" as const) : ("logged" as const),
    };
  },
});

export const revokeInvitation = defineService({
  name: "invitations.revoke",
  summary: "Revoke a live staff invitation immediately.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({ id: invitationId }),
  output: row({ id: uuid }),
  handler: async (input, ctx) => {
    const now = new Date();
    const [row] = await ctx.tx
      .update(staffInvitations)
      .set({ status: "revoked", revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(staffInvitations.id, input.id),
          eq(staffInvitations.status, "pending"),
          gt(staffInvitations.expiresAt, now),
        ),
      )
      .returning({ id: staffInvitations.id });
    if (!row) {
      throw new ServiceError(
        "conflict",
        "Only a live pending invitation can be revoked.",
      );
    }
    ctx.setSubject("staff_invitation", row.id);
    ctx.queueEvent("staffInvitation.revoked", { invitationId: row.id });
    return { id: row.id };
  },
});

export const inspectInvitation = defineService({
  name: "invitations.inspect",
  summary: "Read the safe presentation details carried by an invitation link.",
  kind: "query",
  permission: "public",
  input: z.object({ token: z.string().min(10).max(200) }),
  output: inspectInvitationOutput,
  handler: async (input, ctx): Promise<{
    status: PresentedStatus;
    email?: string;
    roleName?: string;
    expiresAt?: Date;
  }> => {
    const [invitation] = await ctx.tx
      .select()
      .from(staffInvitations)
      .where(eq(staffInvitations.tokenHash, hashToken(input.token)))
      .limit(1);
    if (!invitation) return { status: "invalid" };
    const status = effectiveStatus(invitation.status, invitation.expiresAt);
    if (status !== "pending") return { status, email: invitation.email };
    const role = await findStaffRole(ctx.tx, invitation.roleKey);
    if (!role) return { status: "unavailable", email: invitation.email };
    return {
      status: "pending",
      email: invitation.email,
      roleName: role.name,
      expiresAt: invitation.expiresAt,
    };
  },
});

export const acceptInvitation = defineService({
  name: "invitations.accept",
  summary: "Accept a staff invitation and create its assigned account.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    token: z.string().min(10).max(200),
    password: z.string().min(12).max(200),
  }),
  rateLimit: {
    limit: 20,
    windowSeconds: 15 * 60,
    subject: (input) => hashToken(input.token),
    message: "Too many invitation attempts. Wait a few minutes and try again.",
  },
  output: row({
    userId: uuid,
    email: z.string(),
    role: z.string(),
  }),
  handler: async (input, ctx) => {
    const refuse = () => {
      throw new ServiceError(
        "permission",
        "That invitation is no longer valid. Ask the owner for a new one.",
      );
    };
    const tokenHash = hashToken(input.token);
    const [invitation] = await ctx.tx
      .select()
      .from(staffInvitations)
      .where(eq(staffInvitations.tokenHash, tokenHash))
      .limit(1);
    if (!invitation) return refuse();
    if (effectiveStatus(invitation.status, invitation.expiresAt) !== "pending") {
      return refuse();
    }
    const role = await findStaffRole(ctx.tx, invitation.roleKey);
    if (!role) return refuse();

    const [existing] = await ctx.tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, invitation.email))
      .limit(1);
    if (existing) return refuse();

    const now = new Date();
    const [retired] = await ctx.tx
      .update(staffInvitations)
      .set({ status: "accepted", acceptedAt: now, updatedAt: now })
      .where(
        and(
          eq(staffInvitations.id, invitation.id),
          eq(staffInvitations.tokenHash, tokenHash),
          eq(staffInvitations.status, "pending"),
          gt(staffInvitations.expiresAt, now),
        ),
      )
      .returning({ id: staffInvitations.id });
    if (!retired) return refuse();

    const [user] = await ctx.tx
      .insert(users)
      .values({
        email: invitation.email,
        passwordHash: await hashPassword(input.password),
        role: role.key,
      })
      .returning({ id: users.id })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) return refuse();
        throw error;
      });
    await ctx.tx
      .update(staffInvitations)
      .set({ acceptedUserId: user!.id, updatedAt: new Date() })
      .where(eq(staffInvitations.id, invitation.id));

    ctx.setSubject("staff_invitation", invitation.id);
    ctx.queueEvent("staffInvitation.accepted", {
      invitationId: invitation.id,
      userId: user!.id,
      roleKey: role.key,
    });
    return { userId: user!.id, email: invitation.email, role: role.key };
  },
});

export default [
  acceptInvitation,
  createInvitation,
  inspectInvitation,
  listInvitationRoles,
  listInvitations,
  resendInvitation,
  revokeInvitation,
];
