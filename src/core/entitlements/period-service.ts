// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C9.33/C1.08: shared actual period grants preserve their original history.
import { z } from "zod";
import { defineService } from "@/core/service";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { advanceSubscriptionPeriod as advanceSubscriptionPeriodTx } from "./access";
export const advanceSubscriptionPeriod = defineService({
  name: "entitlements.advanceSubscriptionPeriod", summary: "Create one actual fresh subscription period grant set while preserving previous dates, usage and any overlapping grace.",
  kind: "mutation", permission: "system", external: false,
  input: z.object({ subscriptionId: z.uuid(), contactId: z.uuid(), planId: z.uuid(), planName: z.string().min(1).max(200), startsAt: z.coerce.date(), endsAt: z.coerce.date() }).strict(),
  output: z.object({ grantIds: z.array(z.uuid()).min(1).max(1000), alreadyGranted: z.boolean() }).strict(),
  handler: async (input, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    const result = await advanceSubscriptionPeriodTx(ctx.tx, input);
    ctx.setSubject("subscription", input.subscriptionId); return result;
  },
});
