// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C12.14: held login parents are evidence, not authentication authority.
import { and, eq } from "drizzle-orm";
import { users } from "./schema";
import { contacts } from "@/core/contacts/schema";
import { ServiceError, type Tx } from "@/core/service";

/** Serialize credential issuance against erasure before inspecting its marker. */
export async function requireActiveAccount(tx: Tx, userId: string): Promise<void> {
  const [account] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1).for("update");
  const [erased] = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.userId, userId), eq(contacts.source, "privacy-erasure"))).limit(1);
  if (!account || erased) throw new ServiceError("permission", "This account cannot sign in or issue credentials.");
}
