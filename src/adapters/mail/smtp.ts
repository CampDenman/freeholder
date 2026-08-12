// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// SMTP (MASTER.md §12).
//
// The implementation every self-hoster can actually use: a mailbox they
// already have, or a transactional provider's SMTP endpoint. §12 prefers
// Gmail/Outlook OAuth for transactional mail — the owner's own address, so
// replies land where they read. SMTP remains the portable alternative for a
// mailbox or transactional provider the owner already operates.
import { createTransport } from "nodemailer";
import {
  MailAdapterError,
  type MailAdapter,
  type OutboundEmail,
} from "@/adapters/mail/types";

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  password?: string;
  /** Implicit TLS (port 465). STARTTLS on 587 is negotiated either way. */
  secure?: boolean;
  from: string;
}

export function createSmtpMail(config: SmtpConfig): MailAdapter {
  // nodemailer's own types resolve to `any` through this import path, and the
  // service-layer lint rules refuse to let an `any` spread quietly through the
  // codebase. The two calls that matter are narrowed here instead.
  interface Sender {
    sendMail(options: Record<string, unknown>): Promise<{ messageId: string }>;
  }
  let transport: Sender | undefined;

  return {
    id: "smtp",
    // `both`, because an owner pointing this at a real transactional provider
    // may legitimately broadcast through it. Pointing it at a personal mailbox
    // and then broadcasting is a mistake this cannot see — which is why §12
    // puts the warning in the email-marketing module, next to the send.
    // Bulk delivery needs provider feedback and suppression state. Treating a
    // generic SMTP mailbox as a broadcast carrier would bypass both.
    kind: "transactional",
    delivers: true,
    async send(message: OutboundEmail) {
      // Connected on first use rather than at import, like the database pool:
      // importing a module must never open a socket.
      const sender: Sender = (transport ??= createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure ?? config.port === 465,
        auth: config.user ? { user: config.user, pass: config.password } : undefined,
      }) as Sender);

      try {
        const info = await sender.sendMail({
          from: message.from ?? config.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
          replyTo: message.replyTo,
          headers: message.deliveryId
            ? { "X-Freeholder-Delivery": message.deliveryId }
            : undefined,
        });
        if (!info.messageId) {
          throw new MailAdapterError(
            "SMTP accepted the request without a message id.",
          );
        }
        return { providerRef: info.messageId };
      } catch (error) {
        if (error instanceof MailAdapterError) throw error;
        // Nodemailer errors can include server banners, hostnames and command
        // fragments. Keep those out of API responses and the delivery ledger.
        throw new MailAdapterError(
          "SMTP could not submit the message. Check the configured transport.",
          true,
        );
      }
    },
  };
}
