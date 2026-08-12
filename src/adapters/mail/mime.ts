// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from "node:crypto";
import type { OutboundEmail } from "@/adapters/mail/types";

function header(value: string): string {
  if (/\r|\n/.test(value)) throw new Error("Mail headers cannot contain a line break.");
  return value;
}

function encoded(value: string): string {
  const safe = header(value);
  return /^[\x20-\x7e]*$/.test(safe)
    ? safe
    : `=?UTF-8?B?${Buffer.from(safe, "utf8").toString("base64")}?=`;
}

/** Minimal RFC 5322/MIME message for Gmail's raw-message endpoint. */
export function mimeMessage(message: OutboundEmail, from: string): string {
  const lines = [
    `From: ${header(message.from ?? from)}`,
    `To: ${header(message.to)}`,
    `Subject: ${encoded(message.subject)}`,
    "MIME-Version: 1.0",
    ...(message.replyTo ? [`Reply-To: ${header(message.replyTo)}`] : []),
    ...(message.deliveryId
      ? [`X-Freeholder-Delivery: ${header(message.deliveryId)}`]
      : []),
  ];
  if (!message.html) {
    return [
      ...lines,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      message.text,
    ].join("\r\n");
  }
  const boundary = `freeholder_${randomBytes(18).toString("hex")}`;
  return [
    ...lines,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    message.text,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    message.html,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}
