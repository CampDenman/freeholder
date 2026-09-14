// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Core-owned purgeable stores. Modules register their own from their services.
import { inArray, sql } from "drizzle-orm";
import { conversations } from "@/core/messaging/schema";
import { notes } from "@/core/notes/schema";
import { tasks } from "@/core/tasks/schema";
import { purgeAgedContactRows, registerRetentionSource } from "./registry";

registerRetentionSource({
  kind: "notes",
  tables: ["notes"],
  privacyScope: "contact.notes",
  purge: (args) => purgeAgedContactRows(notes, args),
});

registerRetentionSource({
  kind: "tasks",
  tables: ["tasks"],
  privacyScope: "contact.tasks",
  // Open/blocked work is still owed. Only a finished task ages out, from when
  // it actually finished rather than when somebody first wrote it down.
  purge: (args) =>
    purgeAgedContactRows(tasks, {
      ...args,
      aged: sql`coalesce(${tasks.completedAt}, ${tasks.updatedAt})`,
      extra: inArray(tasks.status, ["done", "cancelled"]),
    }),
});

registerRetentionSource({
  kind: "conversations",
  tables: ["conversations", "messages"],
  privacyScope: "contact.conversations",
  // Last activity, not thread-open time: a two-year-old inbox with a message
  // yesterday is still the live conversation.
  purge: (args) =>
    purgeAgedContactRows(conversations, {
      ...args,
      aged: sql`greatest(${conversations.updatedAt}, ${conversations.createdAt}, ${conversations.lastInboundAt}, ${conversations.lastOutboundAt})`,
    }),
});
