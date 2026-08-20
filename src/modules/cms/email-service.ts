// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Email preview and test-send from a template (C2.19).
import { z } from "zod";
import { eq } from "drizzle-orm";
import { row, uuid } from "@/core/contract";
import { defineService, ServiceError, actorString } from "@/core/service";
import { users } from "@/core/auth/schema";
import { sendMail } from "@/core/mail/service";
import { parseBlockTree } from "./blocks/registry";
import { getTemplate } from "./template-service";
import {
  SAMPLE_EMAIL_VARIABLES,
  fillSlots,
  renderEmailHtml,
  renderEmailText,
  type EmailVariables,
} from "./email-render";

const emailPreview = z.object({
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  variables: z.record(z.string(), z.string()),
});
const mailSend = row({
  id: uuid,
  provider: z.enum([
    "smtp",
    "console",
    "gmail",
    "outlook",
    "resend",
    "postmark",
    "ses",
    "none",
  ]),
  providerRef: z.string().nullable(),
  delivers: z.boolean(),
  duplicate: z.boolean(),
});

export const previewEmail = defineService({
  name: "cms.previewEmail",
  summary: "Table-based HTML and plain text for an email template.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    key: z.string().min(1).max(80),
    locale: z.string().default("en"),
    subject: z.string().max(200).optional(),
    variables: z.record(z.string(), z.string()).optional(),
  }),
  output: emailPreview,
  handler: async (input, ctx) => {
    const template = await ctx.call(getTemplate, {
      key: input.key,
      locale: input.locale,
    });
    if (!template || template.kind !== "email") {
      throw new ServiceError("not_found", "That email template is not on this site.");
    }
    const vars = { ...SAMPLE_EMAIL_VARIABLES, ...(input.variables ?? {}) } as EmailVariables;
    const blocks = parseBlockTree(template.blocks, "email");
    const subject = fillSlots(input.subject ?? template.name, vars);
    return {
      subject,
      html: renderEmailHtml(blocks, vars),
      text: renderEmailText(blocks, vars),
      variables: vars,
    };
  },
});

export const testSendEmail = defineService({
  name: "cms.testSendEmail",
  writeClass: "message",
  summary: "Send this email template to the signed-in person.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    key: z.string().min(1).max(80),
    locale: z.string().default("en"),
    subject: z.string().max(200).optional(),
  }),
  output: mailSend,
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user") {
      throw new ServiceError("permission", "Sign in to send a test email.");
    }
    const preview = await ctx.call(previewEmail, input);
    const [owner] = await ctx.tx
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, ctx.actor.userId))
      .limit(1);
    if (!owner) throw new ServiceError("not_found", "Your user account no longer exists.");
    const result = await sendMail(
      ctx.tx,
      {
        to: owner.email,
        subject: preview.subject,
        text: preview.text,
        html: preview.html,
      },
      { purpose: "transactional", requestedBy: actorString(ctx.actor) },
    );
    ctx.setSubject("mail_delivery", result.id);
    ctx.queueEvent("cms.emailTestSent", { key: input.key, deliveryId: result.id });
    return result;
  },
});
