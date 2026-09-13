// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Core-owned search sources. Modules register their own from their services.
import { and, desc, eq, or, sql } from "drizzle-orm";
import { contacts } from "@/core/contacts/schema";
import { notes } from "@/core/notes/schema";
import { tasks } from "@/core/tasks/schema";
import { conversations } from "@/core/messaging/schema";
import { assets } from "@/core/media/schema";
import { subjectHref } from "@/core/subjects";
import type { Actor } from "@/core/service";
import {
  clipSnippet,
  matchesIlike,
  registerSearchSource,
} from "./registry";

function noteVisible(actor: Actor) {
  if (actor.kind === "system" || actor.kind === "agent") return undefined;
  const self = actor.kind === "user" ? actor.userId : null;
  return self
    ? sql`(${notes.visibility} <> 'private' or ${notes.authorUserId} = ${self})`
    : sql`${notes.visibility} = 'shared'`;
}

registerSearchSource({
  kind: "contact",
  module: "contacts",
  tables: ["contacts"],
  search: async ({ tx, pattern, limit }) => {
    const rows = await tx
      .select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
      })
      .from(contacts)
      .where(or(matchesIlike(contacts.name, pattern), matchesIlike(contacts.email, pattern)))
      .orderBy(desc(contacts.updatedAt))
      .limit(limit);
    return rows.map((row) => ({
      kind: "contact",
      id: row.id,
      title: row.name,
      href: `/admin/contacts/${row.id}`,
      snippet: clipSnippet(row.email),
      contactId: row.id,
      module: "contacts",
    }));
  },
});

registerSearchSource({
  kind: "conversation",
  module: "conversations",
  tables: ["conversations", "messages"],
  search: async ({ tx, pattern, limit }) => {
    const rows = await tx
      .select({
        id: conversations.id,
        subject: conversations.subject,
        contactId: conversations.contactId,
        contactName: contacts.name,
        preview: sql<string | null>`(
          select left(m.body, 140) from messages m
          where m.conversation_id = ${conversations.id}
            and m.body ilike ${pattern} escape ${"\\"}
          order by m.occurred_at desc
          limit 1
        )`,
      })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(
        or(
          matchesIlike(conversations.subject, pattern),
          matchesIlike(contacts.name, pattern),
          matchesIlike(contacts.email, pattern),
          sql`exists (
            select 1 from messages m
            where m.conversation_id = ${conversations.id}
              and m.body ilike ${pattern} escape ${"\\"}
          )`,
        ),
      )
      .orderBy(desc(conversations.updatedAt))
      .limit(limit);
    return rows.map((row) => ({
      kind: "conversation",
      id: row.id,
      title: row.subject?.trim() || row.contactName,
      href: `/admin/inbox/${row.id}`,
      snippet: clipSnippet(row.preview ?? row.subject),
      contactId: row.contactId,
      module: "conversations",
    }));
  },
});

registerSearchSource({
  kind: "note",
  module: "notes",
  tables: ["notes"],
  search: async ({ tx, actor, pattern, limit }) => {
    const visibility = noteVisible(actor);
    const rows = await tx
      .select({
        id: notes.id,
        body: notes.body,
        contactId: notes.contactId,
        subjectType: notes.subjectType,
        subjectId: notes.subjectId,
      })
      .from(notes)
      .where(and(matchesIlike(notes.body, pattern), visibility))
      .orderBy(desc(notes.updatedAt))
      .limit(limit);
    return rows.map((row) => ({
      kind: "note",
      id: row.id,
      title: clipSnippet(row.body) ?? "Note",
      href: row.contactId
        ? `/admin/contacts/${row.contactId}`
        : subjectHref(row.subjectType, row.subjectId),
      snippet: clipSnippet(row.body),
      contactId: row.contactId,
      module: "notes",
    }));
  },
});

registerSearchSource({
  kind: "task",
  module: "tasks",
  tables: ["tasks"],
  search: async ({ tx, pattern, limit }) => {
    const rows = await tx
      .select({
        id: tasks.id,
        title: tasks.title,
        details: tasks.details,
        contactId: tasks.contactId,
      })
      .from(tasks)
      .where(or(matchesIlike(tasks.title, pattern), matchesIlike(tasks.details, pattern)))
      .orderBy(desc(tasks.updatedAt))
      .limit(limit);
    return rows.map((row) => ({
      kind: "task",
      id: row.id,
      title: row.title,
      href: "/admin/tasks",
      snippet: clipSnippet(row.details),
      contactId: row.contactId,
      module: "tasks",
    }));
  },
});

registerSearchSource({
  kind: "media",
  module: "media",
  tables: ["assets"],
  search: async ({ tx, pattern, limit }) => {
    const rows = await tx
      .select({
        id: assets.id,
        filename: assets.filename,
        altText: assets.altText,
      })
      .from(assets)
      .where(
        and(
          eq(assets.status, "ready"),
          or(matchesIlike(assets.filename, pattern), matchesIlike(assets.altText, pattern)),
        ),
      )
      .orderBy(desc(assets.updatedAt))
      .limit(limit);
    return rows.map((row) => ({
      kind: "media",
      id: row.id,
      title: row.filename,
      href: "/admin/media",
      snippet: clipSnippet(row.altText),
      contactId: null,
      module: "media",
    }));
  },
});
