// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Customer email proof and Contact → User linking (MASTER.md §43 C1.05).
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { sendMail } from "@/core/mail/service";
import { roleGrants, users } from "@/core/auth/schema";
import {
  createSession,
  protectSessionMetadata,
} from "@/core/auth/sessions";
import { recordSuccessfulLogin } from "@/core/auth/session-management/service";
import { hashCustomerMagicLinkToken } from "@/core/auth/two-factor-crypto";
import { contacts, customerMagicLinks } from "@/core/contacts/schema";
import { env } from "@/core/env";
import { businessProfile } from "@/core/settings/schema";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { actorString, defineService, ServiceError } from "@/core/service";
import { DEFAULT_LOCALE, translator } from "@/core/i18n";
import {
  localeForContact,
  customerLocalePolicy,
  localePath,
  resolveEnabledLocale,
  type LocalePolicy,
} from "@/core/i18n/customer";

export const CUSTOMER_MAGIC_COOKIE = "freeholder_customer_magic";
const MAGIC_LINK_TTL_MINUTES = 15;
const requestedLocale = z.string().trim().min(2).max(35)
  .regex(/^[a-z]{2}(-[A-Za-z]{2,4})?$/).optional();

function linkUrl(token: string, locale: string, policy: LocalePolicy): string {
  const url = new URL(
    localePath("portal/magic", locale, policy.defaultLocale),
    `${env().APP_URL.replace(/\/+$/, "")}/`,
  );
  url.searchParams.set("token", token);
  // The GET handoff stays scanner-safe and synchronous. These two non-secret
  // values let it preserve the contact's path prefix without a database read.
  url.searchParams.set("locale", locale);
  url.searchParams.set("default", policy.defaultLocale);
  return url.toString();
}

const genericAnswer = {
  ok: true,
  message: "If that address belongs to a customer, a sign-in link is on its way.",
} as const;

export const requestCustomerMagicLink = defineService({
  name: "auth.requestCustomerMagicLink",
  summary: "Send a customer sign-in link without revealing whether the contact exists.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    email: z.string().trim().email().toLowerCase().max(320),
    locale: requestedLocale,
  }),
  rateLimit: {
    limit: 5,
    windowSeconds: 15 * 60,
    subject: (input) => input.email,
    message: "Too many sign-in links were requested. Try again shortly.",
  },
  output: okResult.extend({ message: z.string() }),
  handler: async (input, ctx) => {
    const [contact] = await ctx.tx
      .select()
      .from(contacts)
      .where(eq(contacts.email, input.email))
      .limit(1);
    if (!contact?.email) return genericAnswer;

    const [business] = await ctx.tx
      .select({
        name: businessProfile.name,
        defaultLocale: businessProfile.defaultLocale,
        enabledLocales: businessProfile.enabledLocales,
      })
      .from(businessProfile)
      .limit(1);
    const site = business?.name ?? "this business";
    const policy: LocalePolicy = business ?? {
      defaultLocale: DEFAULT_LOCALE,
      enabledLocales: [DEFAULT_LOCALE],
    };
    // A stored Contact preference wins. The anonymous URL choice is only the
    // first-use fallback and becomes a Contact fact after bearer proof.
    const locale = resolveEnabledLocale(
      contact.preferredLocale ?? input.locale,
      policy,
    );

    await ctx.tx
      .update(customerMagicLinks)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(customerMagicLinks.contactId, contact.id),
          isNull(customerMagicLinks.usedAt),
        ),
      );
    const token = randomBytes(32).toString("base64url");
    const [created] = await ctx.tx
      .insert(customerMagicLinks)
      .values({
        contactId: contact.id,
        email: contact.email,
        locale,
        tokenHash: hashCustomerMagicLinkToken(token),
        expiresAt: sql`now() + make_interval(mins => ${MAGIC_LINK_TTL_MINUTES})`,
      })
      .returning({ id: customerMagicLinks.id });
    if (!created) throw new Error("customer magic-link insert returned no row");
    const t = translator(locale);
    try {
      await sendMail(ctx.tx, {
        to: contact.email,
        subject: t("portal.magic.email.subject", { site }),
        text: [
          t("portal.magic.email.intro", { site }),
          "",
          linkUrl(token, locale, policy),
          "",
          t("portal.magic.email.expires"),
          t("portal.magic.email.ignore"),
        ].join("\n"),
      }, {
        requestedBy: actorString(ctx.actor),
        idempotencyKey: `customer-magic-link:${created.id}`,
      });
    } catch {
      // The public service must not reveal that only an existing address
      // reached the adapter. Retire the undelivered credential and return the
      // same answer an unknown address receives; operators still get evidence.
      await ctx.tx
        .delete(customerMagicLinks)
        .where(eq(customerMagicLinks.id, created.id));
      console.error("customer magic-link delivery failed");
    }
    ctx.setSubject("contact", contact.id);
    await ctx.emitTimeline({
      contactId: contact.id,
      eventType: "contact.magicLinkRequested",
      subjectType: "contact",
      subjectId: contact.id,
    });
    return genericAnswer;
  },
});

function invalidLink(): never {
  throw new ServiceError(
    "permission",
    "That sign-in link is no longer valid. Ask for a new one.",
  );
}

export const consumeCustomerMagicLink = defineService({
  name: "auth.consumeCustomerMagicLink",
  summary: "Prove a contact email and link it to its single portal account.",
  kind: "mutation",
  permission: "public",
  input: z.object({ token: z.string().min(20).max(200) }),
  rateLimit: {
    limit: 20,
    windowSeconds: 15 * 60,
    subject: () => "customer-magic",
    message: "Too many sign-in attempts. Wait a few minutes and try again.",
  },
  output: row({
    contactId: uuid,
    userId: uuid,
    linked: z.boolean(),
    defaultLocale: z.string(),
    enabledLocales: listed(z.string()),
    locale: z.string(),
    token: z.string(),
    sessionId: uuid,
    expiresAt: timestamp,
  }),
  handler: async (input, ctx) => {
    const [link] = await ctx.tx
      .select()
      .from(customerMagicLinks)
      .where(eq(customerMagicLinks.tokenHash, hashCustomerMagicLinkToken(input.token)))
      .limit(1);
    if (!link || link.usedAt || link.expiresAt.getTime() <= Date.now()) invalidLink();
    const [spent] = await ctx.tx
      .update(customerMagicLinks)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(customerMagicLinks.id, link.id),
          isNull(customerMagicLinks.usedAt),
          gt(customerMagicLinks.expiresAt, new Date()),
        ),
      )
      .returning({ id: customerMagicLinks.id });
    if (!spent) invalidLink();

    const [contact] = await ctx.tx
      .select()
      .from(contacts)
      .where(eq(contacts.id, link.contactId))
      .limit(1);
    if (!contact?.email || contact.email !== link.email) invalidLink();

    if (!contact.preferredLocale && link.locale) {
      const policy = await customerLocalePolicy(ctx.tx);
      await ctx.tx
        .update(contacts)
        .set({ preferredLocale: resolveEnabledLocale(link.locale, policy) })
        .where(eq(contacts.id, contact.id));
    }

    let [user] = contact.userId
      ? await ctx.tx.select().from(users).where(eq(users.id, contact.userId)).limit(1)
      : await ctx.tx.select().from(users).where(eq(users.email, contact.email)).limit(1);
    let linked = false;
    if (user) {
      if (user.email !== contact.email) invalidLink();
      const grants = await ctx.tx
        .select({ module: roleGrants.module })
        .from(roleGrants)
        .where(eq(roleGrants.roleKey, user.role));
      if (grants.length > 0) invalidLink();
      const [otherContact] = await ctx.tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(eq(contacts.userId, user.id), ne(contacts.id, contact.id)),
        )
        .limit(1);
      if (otherContact) invalidLink();
    } else {
      [user] = await ctx.tx
        .insert(users)
        .values({ email: contact.email, passwordHash: null, role: "customer" })
        .returning();
    }
    if (!contact.userId) {
      await ctx.tx
        .update(contacts)
        .set({ userId: user!.id })
        .where(eq(contacts.id, contact.id));
      linked = true;
    }

    const metadata = protectSessionMetadata(ctx.actor.request);
    const session = await createSession(ctx.tx, user!.id, metadata);
    await recordSuccessfulLogin(ctx.tx, user!.id, session.sessionId, metadata);
    await ctx.tx
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user!.id));
    ctx.setSubject("contact", contact.id);
    await ctx.emitTimeline({
      contactId: contact.id,
      eventType: linked ? "contact.portalAccountLinked" : "contact.magicLinkSignedIn",
      subjectType: "contact",
      subjectId: contact.id,
    });
    const locale = await localeForContact(ctx.tx, contact.id);
    return { contactId: contact.id, userId: user!.id, linked, ...locale, ...session };
  },
});

export default [requestCustomerMagicLink, consumeCustomerMagicLink];
