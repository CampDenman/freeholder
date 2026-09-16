// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Reversible removal for first-class records (C11.14).
//
// Notes and tasks grew trash/restore/purge first (#381); this is the shape
// they proved, lifted into one factory so the remaining record families hold
// identical semantics instead of five near-copies that drift:
//
// **Remove is trash, never deletion.** The original row stays in place with
// its `trashed_at` stamped, so its identity — the slug a page lives at, the
// definition a segment compiles from — is preserved and cannot be taken by a
// new record while it recovers. Every ordinary read filters `isNull
// (trashed_at)`; only the trash list reads the other side.
//
// **Restore returns the same row.** No replacement record is created, so
// links that point at the original id keep working. A family with a natural
// key (a page's slug) can pass `restoreCheck` to refuse restoration when its
// name has genuinely been taken — which trash itself normally prevents.
//
// **Purge is the only deletion, and it is gated.** Typed `PURGE`
// confirmation plus recent identity verification (step-up), an optional
// hold guard, and an optional child cleanup that runs in the same
// transaction. Families whose rows carry contact evidence in child tables
// pass a `holdGuard` so an active retention exception on the person blocks
// the cascade; families with no contact data at all (pages, saved views)
// omit it, because a contact-scoped hold cannot name a record that holds no
// contact data.
//
// The thirty-day sweep reclaims storage in bounded batches without waiting
// for somebody to empty trash by hand, and honours the same guards.
import { z } from "zod";
import { and, asc, eq, inArray, isNotNull, isNull, lt, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { row, uuid } from "@/core/contract";
import { isForeignKeyViolation } from "@/core/db";
import { defineService, ServiceError, type Actor, type Tx } from "@/core/service";

/** Thirty days, the trash window every family shares. */
const TRASH_WINDOW_MS = 30 * 86_400_000;
/** One sweep claims at most this many rows, whatever the backlog. */
const PURGE_BATCH_LIMIT = 500;

const id = z.string().uuid();

/**
 * The table shape every trash family has: a uuid primary key and the trash
 * timestamp. Typed structurally so any family's drizzle table fits without
 * the factory importing module schemas; the column configs are written
 * against drizzle's own builder types so `eq` and friends stay typed.
 */
export interface TrashedTable extends PgTable {
  id: PgColumn<{
    name: string;
    tableName: string;
    dataType: "string";
    columnType: string;
    data: string;
    driverParam: string;
    notNull: true;
    hasDefault: boolean;
    isPrimaryKey: true;
    isAutoincrement: false;
    hasRuntimeDefault: boolean;
    enumValues: undefined;
    baseColumn: never;
    generated: undefined;
  }>;
  trashedAt: PgColumn<{
    name: string;
    tableName: string;
    dataType: "date";
    columnType: string;
    data: Date;
    driverParam: string;
    notNull: false;
    hasDefault: false;
    isPrimaryKey: false;
    isAutoincrement: false;
    hasRuntimeDefault: false;
    enumValues: undefined;
    baseColumn: never;
    generated: undefined;
  }>;
}

export interface TrashFamilyOptions<TRecord> {
  /** Service-name prefix and event family: `${family}.remove` etc. */
  family: string;
  /**
   * Explicit service names for families whose verb reads better qualified
   * (`cms.removePage` among sections and templates). Defaults to the plain
   * family verbs.
   */
  names?: {
    remove: string;
    restore: string;
    purge: string;
    purgeExpired: string;
  };
  /** Event names, defaulting to `${family}.trashed` and friends. */
  events?: { trashed: string; restored: string; purged: string };
  table: TrashedTable;
  /** The full row contract, used as the restore output. */
  rowSchema: z.ZodTypeAny;
  /** `setSubject` kind for audit attribution. */
  subjectKind: string;
  /** The not-found sentence this family already uses ("That form is not here."). */
  gone: string;
  /**
   * `scoped` rides the family's module grant, like every other record
   * service. `authenticated` plus `ownerColumn` is for personal
   * configuration such as saved views, where the grant that matters is
   * ownership itself: only the owner can remove, restore or purge their
   * own row, and only a person (never a key or the system) can act.
   */
  permission?: "scoped" | "authenticated";
  ownerColumn?: PgColumn;
  /**
   * Holds cannot apply to what a record does not have. Families whose rows
   * (or whose child rows, via cascade) carry contact personal data pass a
   * guard; families with none omit it, and the purge stays unguarded because
   * there is nothing a contact-scoped hold could name.
   */
  holdGuard?: SQL;
  /** Deletes child rows that belong to the purged record(s), in-transaction. */
  purgeChildren?: (tx: Tx, ids: string[]) => Promise<void>;
  /** Refuses restoration the family cannot honour (a taken slug). */
  restoreCheck?: (tx: Tx, record: TRecord) => Promise<void>;
  /** Translate a referential-integrity refusal (segment still wired to a popup). */
  inUseMessage?: string;
}

export function makeTrashServices<TRecord = Record<string, unknown> & { id: string }>(
  options: TrashFamilyOptions<TRecord>,
) {
  const { table } = options;
  const names = options.names ?? {
    remove: `${options.family}.remove`,
    restore: `${options.family}.restore`,
    purge: `${options.family}.purge`,
    purgeExpired: `${options.family}.purgeExpired`,
  };
  const events = options.events ?? {
    trashed: `${options.family}.trashed`,
    restored: `${options.family}.restored`,
    purged: `${options.family}.purged`,
  };
  const permission = options.permission ?? "scoped";
  const idOut = row({ id: uuid });

  /** Ownership is a fact about rows, so it is re-verified inside the write. */
  function ownership(actor: Actor): SQL[] {
    if (!options.ownerColumn) return [];
    if (actor.kind !== "user") {
      throw new ServiceError("permission", "Sign in to manage your records.");
    }
    return [eq(options.ownerColumn, actor.userId)];
  }

  const remove = defineService({
    name: names.remove,
    summary: `Move one ${options.subjectKind} to trash for thirty days.`,
    kind: "mutation",
    permission,
    writeClass: "destructive",
    input: z.object({ id }),
    output: idOut,
    handler: async (input, ctx) => {
      const [removed] = await ctx.tx
        .update(table)
        .set({ trashedAt: new Date() })
        .where(and(eq(table.id, input.id), isNull(table.trashedAt), ...ownership(ctx.actor)))
        .returning({ id: table.id });
      if (!removed) throw new ServiceError("not_found", options.gone);
      ctx.setSubject(options.subjectKind, removed.id);
      ctx.queueEvent(events.trashed, { id: removed.id });
      return removed;
    },
  });

  const restore = defineService({
    name: names.restore,
    summary: `Restore a trashed ${options.subjectKind} with its original identity.`,
    kind: "mutation",
    permission,
    writeClass: "write",
    input: z.object({ id }),
    output: options.rowSchema,
    handler: async (input, ctx) => {
      const [restored] = await ctx.tx
        .update(table)
        .set({ trashedAt: null })
        .where(and(eq(table.id, input.id), isNotNull(table.trashedAt), ...ownership(ctx.actor)))
        .returning();
      if (!restored) throw new ServiceError("not_found", `That trashed ${options.subjectKind} is not here.`);
      const record = restored as TRecord & { id: string };
      if (options.restoreCheck) await options.restoreCheck(ctx.tx, record);
      ctx.setSubject(options.subjectKind, record.id);
      ctx.queueEvent(events.restored, { id: record.id });
      return record;
    },
  });

  const purge = defineService({
    name: names.purge,
    summary: `Permanently delete a trashed ${options.subjectKind} unless protected.`,
    kind: "mutation",
    permission,
    writeClass: "destructive",
    stepUp: true,
    input: z.object({ id, confirmation: z.literal("PURGE") }),
    output: idOut,
    handler: async (input, ctx) => {
      let removed: { id: string } | undefined;
      try {
        [removed] = await ctx.tx
          .delete(table)
          .where(
            and(
              eq(table.id, input.id),
              isNotNull(table.trashedAt),
              options.holdGuard,
              ...ownership(ctx.actor),
            ),
          )
          .returning({ id: table.id });
      } catch (error) {
        if (options.inUseMessage && isForeignKeyViolation(error)) {
          throw new ServiceError("conflict", options.inUseMessage);
        }
        throw error;
      }
      if (!removed) {
        throw new ServiceError(
          "conflict",
          "That record cannot be purged. It may be unavailable or subject to a retention hold.",
        );
      }
      if (options.purgeChildren) await options.purgeChildren(ctx.tx, [removed.id]);
      ctx.setSubject(options.subjectKind, removed.id);
      ctx.queueEvent(events.purged, { id: removed.id });
      return removed;
    },
  });

  const purgeExpired = defineService({
    name: names.purgeExpired,
    summary: `Purge a bounded batch of thirty-day ${options.subjectKind} trash.`,
    kind: "mutation",
    permission: "system",
    external: false,
    input: z.object({}),
    output: z.object({ purged: z.number().int().nonnegative() }),
    handler: async (_input, ctx) => {
      const where = and(
        lt(table.trashedAt, new Date(Date.now() - TRASH_WINDOW_MS)),
        options.holdGuard,
      );
      const batch = ctx.tx
        .select({ id: table.id })
        .from(table)
        .where(where)
        .orderBy(asc(table.id))
        .limit(PURGE_BATCH_LIMIT)
        .for("update", { skipLocked: true });
      const removed = await ctx.tx
        .delete(table)
        .where(inArray(table.id, batch))
        .returning({ id: table.id });
      if (options.purgeChildren && removed.length > 0) {
        await options.purgeChildren(ctx.tx, removed.map((r) => r.id));
      }
      return { purged: removed.length };
    },
  });

  return { remove, restore, purge, purgeExpired };
}
