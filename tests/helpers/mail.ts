// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Explicitly cross the post-commit mail worker boundary in tests that inspect
// console-delivered links or localized message content.
import { db } from "@/core/db";
import { mailOutbox } from "@/core/mail/schema";
import { deliverQueuedMail } from "@/core/mail/service";

export async function flushQueuedMail(): Promise<number> {
  const queued = await db()
    .select({ deliveryId: mailOutbox.deliveryId })
    .from(mailOutbox);
  for (const row of queued) {
    await deliverQueuedMail(row.deliveryId);
  }
  return queued.length;
}
