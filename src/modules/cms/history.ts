// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Attributed editorial history (C2.02 complete author history).
//
// Revisions are the record of who did what. The stored actor is the same
// `user:<id>` / `agent:<name>` / `system` string as the audit log; this module
// is the one place that turns that string into something a person can read.
import { inArray } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import type { Tx } from "@/core/service";
import { contentRevisions } from "./schema";

export const REVISION_KINDS = [
  "create",
  "autosave",
  "named",
  "publish",
  "unpublish",
  "restore",
  "schedule",
  "approval",
] as const;

export type RevisionKind = (typeof REVISION_KINDS)[number];

export type AuthorKind = "user" | "agent" | "system" | "anonymous";

export type AuthorRef = {
  actor: string;
  kind: AuthorKind;
  id: string | null;
  label: string;
};

export function parseActor(actor: string): { kind: AuthorKind; id: string | null } {
  if (actor === "system") return { kind: "system", id: null };
  if (actor === "anonymous") return { kind: "anonymous", id: null };
  if (actor.startsWith("agent:")) return { kind: "agent", id: actor.slice("agent:".length) };
  if (actor.startsWith("user:")) return { kind: "user", id: actor.slice("user:".length) };
  return { kind: "anonymous", id: null };
}

export function authorRef(actor: string, emails: ReadonlyMap<string, string>): AuthorRef {
  const parsed = parseActor(actor);
  if (parsed.kind === "user" && parsed.id) {
    return {
      actor,
      kind: "user",
      id: parsed.id,
      label: emails.get(parsed.id) ?? actor,
    };
  }
  if (parsed.kind === "agent") {
    return { actor, kind: "agent", id: parsed.id, label: parsed.id ?? actor };
  }
  return { actor, kind: parsed.kind, id: parsed.id, label: actor };
}

export async function resolveAuthors(
  tx: Tx,
  actors: readonly string[],
): Promise<Map<string, AuthorRef>> {
  const unique = [...new Set(actors)];
  const userIds = unique.flatMap((actor) => {
    const parsed = parseActor(actor);
    return parsed.kind === "user" && parsed.id ? [parsed.id] : [];
  });
  const emails = new Map<string, string>();
  if (userIds.length > 0) {
    const rows = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(inArray(users.id, userIds));
    for (const row of rows) emails.set(row.id, row.email);
  }
  return new Map(unique.map((actor) => [actor, authorRef(actor, emails)]));
}

export async function writeRevision(
  tx: Tx,
  values: {
    subjectType: "page" | "section";
    subjectId: string;
    title: string | null;
    blocks: unknown;
    seo?: unknown;
    kind: RevisionKind;
    name?: string | null;
    actor: string;
  },
) {
  const [row] = await tx
    .insert(contentRevisions)
    .values({
      subjectType: values.subjectType,
      subjectId: values.subjectId,
      title: values.title,
      blocks: values.blocks,
      seo: values.seo ?? {},
      kind: values.kind,
      name: values.name ?? null,
      actor: values.actor,
    })
    .returning();
  return row!;
}
