// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C6.19/C8.17/C9.38: one email-proof door for new and returning customers.
import { z } from "zod";
import { assertMailReady } from "@/core/mail/service";
import { requestCustomerMagicLink } from "@/core/auth/magic-links/service";
import { resolveContact } from "@/core/contacts/service";
import { defineService, ServiceError } from "@/core/service";

export const customerSignInStatus = defineService({
  name: "portal.signInStatus", summary: "Whether this site has customer sign-in email configured.", kind: "query", permission: "public",
  input: z.object({}), output: z.object({ available: z.boolean() }),
  handler: async (_input, ctx) => {
    try { await assertMailReady(ctx.tx, "transactional"); return { available: true }; }
    catch (error) { if (error instanceof ServiceError) return { available: false }; throw error; }
  },
});

export const requestCustomerSignIn = defineService({
  name: "portal.requestSignIn", summary: "Resolve a customer and send the existing email proof before granting access.", kind: "mutation", permission: "public", writeClass: "write",
  rateLimit: { limit: 5, windowSeconds: 900, subject: input => input.email, message: "Please wait before requesting another sign-in link." },
  input: z.object({ email: z.string().trim().email().toLowerCase().max(320), name: z.string().trim().min(1).max(200).optional(), locale: z.string().max(35).optional() }),
  output: z.object({ sent: z.literal(true) }),
  handler: async (input, ctx) => {
    await assertMailReady(ctx.tx, "transactional");
    await ctx.callAsSystem(resolveContact, { email: input.email, name: input.name, source: "customer_sign_in", preferredLocale: input.locale });
    await ctx.call(requestCustomerMagicLink, { email: input.email, locale: input.locale });
    return { sent: true as const };
  },
});
