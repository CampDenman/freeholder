// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Core-owned purgeable stores. Modules register their own from their services.
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
  purge: (args) => purgeAgedContactRows(tasks, args),
});

registerRetentionSource({
  kind: "conversations",
  tables: ["conversations", "messages"],
  privacyScope: "contact.conversations",
  purge: (args) => purgeAgedContactRows(conversations, args),
});
