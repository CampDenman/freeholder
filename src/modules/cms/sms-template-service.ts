// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// SMS uses the same stored templates, locale variants, and locked variable
// slots as email (MASTER.md §4.14, C7.14).
import { eq } from "drizzle-orm";
import { z } from "zod";
import { contacts } from "@/core/contacts/schema";
import { listed, row, uuid } from "@/core/contract";
import { bookings } from "@/core/scheduling/schema";
import { getService, defineService, ServiceError, type ServiceContext } from "@/core/service";
import { businessProfile } from "@/core/settings/schema";
import { parseBlockTree } from "./blocks/registry";
import { SAMPLE_EMAIL_VARIABLES, renderEmailText, type EmailVariables } from "./email-render";
import { getTemplate } from "./template-service";

const variableValues = z.record(z.string(), z.string().max(4_000));
const purpose = z.enum(["transactional", "marketing", "support"]);

const smsPreview = row({
  templateId: uuid,
  locale: z.string(),
  timezone: z.string(),
  body: z.string(),
  variables: variableValues,
  estimatedSegments: z.number().int().positive(),
});

const smsSendResult = row({
  sent: z.boolean(),
  providerRef: z.string().nullable(),
  reason: z.string().nullable(),
  messageId: uuid.nullable(),
});

const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà".split(""),
);
const GSM_EXTENDED = new Set("^{}\\[~]|€".split(""));

/** Carrier billing estimate for preview; the delivery row keeps the actual. */
export function estimatedSmsSegments(body: string): number {
  let units = 0;
  let gsm = true;
  for (const character of body) {
    if (GSM_BASIC.has(character)) units += 1;
    else if (GSM_EXTENDED.has(character)) units += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (!gsm) {
    const unicodeUnits = body.length;
    return Math.max(1, Math.ceil(unicodeUnits / (unicodeUnits <= 70 ? 70 : 67)));
  }
  return Math.max(1, Math.ceil(units / (units <= 160 ? 160 : 153)));
}

function firstName(name: string): string {
  return name.trim().split(/\s+/u)[0] ?? name;
}

async function renderedSms(
  ctx: ServiceContext,
  input: {
    key: string;
    contactId?: string;
    bookingId?: string;
    locale?: string;
    variables?: Record<string, string>;
  },
) {
  let contact: typeof contacts.$inferSelect | undefined;
  let booking: typeof bookings.$inferSelect | undefined;
  if (input.bookingId) {
    [booking] = await ctx.tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, input.bookingId))
      .limit(1);
    if (!booking) throw new ServiceError("not_found", "That appointment is not here.");
  }
  const contactId = input.contactId ?? booking?.contactId;
  if (contactId) {
    [contact] = await ctx.tx
      .select()
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);
    if (!contact) throw new ServiceError("not_found", "That contact is not here.");
  }
  if (contact && booking && booking.contactId !== contact.id) {
    throw new ServiceError("validation", "That appointment belongs to a different contact.");
  }

  const [business] = await ctx.tx.select().from(businessProfile).limit(1);
  const locale = input.locale ?? contact?.preferredLocale ?? business?.defaultLocale ?? "en";
  const timezone = contact?.timezone ?? business?.timezone ?? "UTC";
  const template = await ctx.call(getTemplate, { key: input.key, locale });
  if (!template || template.kind !== "sms") {
    throw new ServiceError("not_found", "That text-message template is not on this site.");
  }

  const variables: EmailVariables = {
    ...SAMPLE_EMAIL_VARIABLES,
    ...(contact
      ? {
          "contact.first_name": firstName(contact.name),
          "contact.email": contact.email ?? "",
        }
      : {}),
    ...(business ? { "business.name": business.name } : {}),
    ...(booking
      ? {
          "booking.starts_at_local": new Intl.DateTimeFormat(locale, {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: timezone,
          }).format(booking.startsAt),
        }
      : {}),
    ...(input.variables ?? {}),
  };
  const body = renderEmailText(parseBlockTree(template.blocks, "email"), variables).trim();
  if (!body) throw new ServiceError("validation", "That text-message template is empty.");
  if (body.length > 4_000) {
    throw new ServiceError("validation", "That rendered text message is longer than 4,000 characters.");
  }
  const unresolved = [...body.matchAll(/\{\{\s*([a-z0-9._]+)\s*\}\}/gi)].map(
    (match) => match[1]!,
  );
  if (unresolved.length > 0) {
    throw new ServiceError(
      "validation",
      `Fill the template variable${unresolved.length === 1 ? "" : "s"}: ${[...new Set(unresolved)].join(", ")}.`,
    );
  }
  return {
    template,
    contact,
    booking,
    locale: template.locale,
    timezone,
    variables: Object.fromEntries(
      Object.entries(variables).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
    body,
  };
}

export const previewSms = defineService({
  name: "cms.previewSms",
  summary: "Render an SMS template in a contact's locale and timezone.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    key: z.string().min(1).max(80),
    contactId: z.string().uuid().optional(),
    bookingId: z.string().uuid().optional(),
    locale: z.string().min(2).max(35).optional(),
    variables: variableValues.optional(),
  }),
  output: smsPreview,
  handler: async (input, ctx) => {
    const rendered = await renderedSms(ctx, input);
    return {
      templateId: rendered.template.id,
      locale: rendered.locale,
      timezone: rendered.timezone,
      body: rendered.body,
      variables: rendered.variables,
      estimatedSegments: estimatedSmsSegments(rendered.body),
    };
  },
});

export const sendSmsTemplate = defineService({
  name: "cms.sendSmsTemplate",
  summary: "Render and send one localized SMS template to a contact.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "message",
  input: z.object({
    key: z.string().min(1).max(80),
    contactId: z.string().uuid(),
    bookingId: z.string().uuid().optional(),
    purpose: purpose.default("transactional"),
    variables: variableValues.optional(),
    mediaAssetIds: listed(z.string().uuid()).max(10).default([]),
    idempotencyKey: z.string().trim().min(1).max(200),
  }),
  output: smsSendResult,
  handler: async (input, ctx) => {
    const rendered = await renderedSms(ctx, input);
    if (!rendered.contact?.phone) {
      throw new ServiceError("validation", "That contact has no phone number.");
    }
    return ctx.call(getService("messaging.sendSms"), {
      contactId: rendered.contact.id,
      to: rendered.contact.phone,
      body: rendered.body,
      purpose: input.purpose,
      templateId: rendered.template.id,
      mediaAssetIds: input.mediaAssetIds,
      idempotencyKey: input.idempotencyKey,
      ...(ctx.actor.kind === "system" && rendered.booking
        ? {
            policyException: {
              kind: "booking_update",
              referenceId: rendered.booking.id,
            },
          }
        : {}),
    });
  },
});

export const testSendSms = defineService({
  name: "cms.testSendSms",
  summary: "Send an SMS template to the signed-in person's linked contact.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "message",
  input: z.object({
    key: z.string().min(1).max(80),
    variables: variableValues.optional(),
  }),
  output: smsSendResult,
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user") {
      throw new ServiceError("permission", "Sign in to send a test text message.");
    }
    const [linked] = await ctx.tx
      .select()
      .from(contacts)
      .where(eq(contacts.userId, ctx.actor.userId))
      .limit(1);
    if (!linked?.phone) {
      throw new ServiceError(
        "validation",
        "Link your user to a contact with a phone number before sending a test.",
      );
    }
    if (linked.phoneStatus === "invalid") {
      throw new ServiceError("validation", "Your linked contact's phone number is marked invalid.");
    }
    const rendered = await renderedSms(ctx, {
      key: input.key,
      contactId: linked.id,
      variables: input.variables,
    });
    const result = await ctx.callAsSystem(getService("messaging.sendSms"), {
      contactId: linked.id,
      to: linked.phone,
      body: rendered.body,
      purpose: "support",
      templateId: rendered.template.id,
      mediaAssetIds: [],
      idempotencyKey: `sms-template-test:${rendered.template.id}:${Date.now()}`,
      policyException: {
        kind: "customer_requested_reply",
        referenceId: rendered.template.id,
      },
    });
    ctx.queueEvent("cms.smsTestSent", {
      templateId: rendered.template.id,
      contactId: linked.id,
    });
    return result;
  },
});

export default [previewSms, sendSmsTemplate, testSendSms];
