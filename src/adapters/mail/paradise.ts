// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Paradise Modern mail (C3.30, MASTER.md §12).
//
// `POST /api/site-self/email/send` with the site key. PM sends from the
// site's own verified domain and checks a `permission` declaration
// immediately before it reaches its provider, which is exactly the contract
// §12 already wants from a sender:
//
// - **Transactional** mail names its reason and the event behind it. The
//   delivery worker supplies both; a module cannot relabel a campaign.
// - **Campaign** mail is `marketing` under one topic, and PM refuses it
//   unless PM holds a direct opt-in for that recipient. Freeholder's own
//   consent ledger is the proof; when PM has not seen it yet this adapter
//   records it (`/api/site-self/email/consent`) from the retained evidence
//   and tries once more. A recipient whose consent PM cannot accept —
//   imported, verbal, or none — is refused, never re-labelled.
//
// Campaigns also keep the site's own one-click unsubscribe. PM would
// otherwise add its own link and footer, and a reader must never meet the
// platform behind the site; so a marketing send without the site's
// List-Unsubscribe headers is refused here rather than sent with PM's.
import { paradiseRequest, ParadiseRequestError } from "@/adapters/paradise/http";
import {
  MailAdapterError,
  type MailAdapter,
  type MailPermission,
  type OutboundEmail,
} from "@/adapters/mail/types";

export interface ParadiseMailOptions {
  kind: "transactional" | "bulk";
  /** Default sender; PM uses the site's own `noreply@` when absent. */
  from?: string;
  /** PM subscription topic campaign mail is sent under. */
  topic: string;
}

function parseFrom(value: string | undefined): { from?: string; fromName?: string } {
  if (!value) return {};
  const angled = /^\s*"?([^"<]*?)"?\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(value);
  if (angled) {
    const name = angled[1]!.trim().slice(0, 78);
    return { from: angled[2]!.toLowerCase(), ...(name ? { fromName: name } : {}) };
  }
  return { from: value.trim().toLowerCase() };
}

function asMailError(error: unknown): MailAdapterError {
  if (error instanceof MailAdapterError) return error;
  if (!(error instanceof ParadiseRequestError)) {
    return new MailAdapterError("Paradise Modern could not submit this message.", true);
  }
  const code = error.code;
  if (code === "EMAIL_REQUEST_IN_FLIGHT") {
    return new MailAdapterError("Paradise Modern is still sending this message.", true, error.status, code);
  }
  if (error.status === 402) {
    // Prepaid mail balance is empty. Worth retrying once the owner tops up;
    // the job's retry ceiling turns a long outage into a visible failure.
    return new MailAdapterError("The Paradise Modern mail balance is empty.", true, 402, code);
  }
  if (code === "EMAIL_CONSENT_REQUIRED") {
    return new MailAdapterError(
      "Paradise Modern holds no opt-in it can accept for this recipient, so the campaign was not sent to them.",
      false,
      error.status,
      code,
    );
  }
  if (code === "EMAIL_PERMISSION_REQUIRED") {
    return new MailAdapterError("Paradise Modern refused a message with no permission basis.", false, error.status, code);
  }
  return new MailAdapterError(error.message, error.retryable, error.status || undefined, code);
}

function wirePermission(permission: MailPermission, topic: string) {
  return permission.purpose === "marketing"
    ? { purpose: "marketing" as const, topic }
    : { purpose: "transactional" as const, reason: permission.reason, eventRef: permission.eventRef.slice(0, 1000) };
}

export function createParadiseMail(options: ParadiseMailOptions): MailAdapter {
  async function submit(message: OutboundEmail, permission: MailPermission, attempt: "first" | "consented") {
    const sender = parseFrom(message.from ?? options.from);
    return paradiseRequest<{ messageId?: string; deliveryId?: string; unsubscribe?: string }>(
      "/api/site-self/email/send",
      {
        timeoutMs: 30_000,
        body: {
          to: message.to,
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
          ...sender,
          ...(message.replyTo ? { replyTo: message.replyTo } : {}),
          ...(message.headers?.["List-Unsubscribe"]
            ? {
                listUnsubscribe: message.headers["List-Unsubscribe"],
                listUnsubscribePost: message.headers["List-Unsubscribe-Post"],
              }
            : {}),
          permission: wirePermission(permission, options.topic),
          // PM's idempotency key: a retried job converges on one message.
          // PM keeps a permission refusal as that key's final answer, so the
          // send after recording consent is a second, distinct request.
          ...(message.deliveryId
            ? { requestId: `freeholder:${message.deliveryId}${attempt === "consented" ? ":consented" : ""}` }
            : {}),
        },
      },
    );
  }

  return {
    id: "paradise",
    kind: options.kind,
    delivers: true,
    async send(message) {
      const permission = message.permission;
      if (!permission) {
        throw new MailAdapterError("Paradise Modern mail needs a declared permission basis.");
      }
      if (options.kind === "transactional" && permission.purpose !== "transactional") {
        throw new MailAdapterError("Campaign mail cannot leave through the transactional sender.");
      }
      if (options.kind === "bulk" && permission.purpose !== "marketing") {
        throw new MailAdapterError("The campaign sender only carries marketing mail.");
      }
      if (permission.purpose === "marketing" && !permission.evidence) {
        // Freeholder's own ledger holds no opt-in PM could accept for this
        // address. Even if PM had one from elsewhere, this site cannot prove
        // it, so the campaign does not leave.
        throw new MailAdapterError(
          "This recipient has no recorded marketing opt-in Paradise Modern can accept, so the campaign was not sent to them.",
          false,
          undefined,
          "EMAIL_CONSENT_REQUIRED",
        );
      }
      if (
        permission.purpose === "marketing" &&
        (!message.headers?.["List-Unsubscribe"] ||
          message.headers["List-Unsubscribe-Post"] !== "List-Unsubscribe=One-Click")
      ) {
        throw new MailAdapterError(
          "Campaign mail through Paradise Modern must carry the site's own one-click unsubscribe.",
        );
      }

      let response;
      try {
        response = await submit(message, permission, "first");
      } catch (error) {
        const refused =
          error instanceof ParadiseRequestError && error.code === "EMAIL_CONSENT_REQUIRED";
        if (!refused || permission.purpose !== "marketing" || !permission.evidence) {
          // (`evidence` is always present for marketing here; the check
          // narrows the type.)
          throw asMailError(error);
        }
        // PM has not seen this opt-in yet (it predates the switch, or the
        // mirror has not run). Record the retained evidence, then once more.
        try {
          await paradiseRequest("/api/site-self/email/consent", {
            body: {
              email: message.to,
              topic: options.topic,
              directPermission: true,
              ...permission.evidence,
            },
          });
          response = await submit(message, permission, "consented");
        } catch (retryError) {
          throw asMailError(retryError);
        }
      }
      const ref = response.body.messageId ?? response.body.deliveryId;
      if (!ref) {
        throw new MailAdapterError("Paradise Modern accepted the request without a message id.");
      }
      return { providerRef: ref };
    },
    async verifySender(sender) {
      let me;
      try {
        me = await paradiseRequest<{ domain?: string; mailgunDomainStatus?: string }>(
          "/api/site-self/me",
          { method: "GET" },
        );
      } catch (error) {
        throw asMailError(error);
      }
      const domain = typeof me.body.domain === "string" ? me.body.domain.toLowerCase() : "";
      const senderDomain = sender.email.split("@")[1]?.toLowerCase() ?? "";
      const status = typeof me.body.mailgunDomainStatus === "string" &&
        /^[a-z_]{1,40}$/.test(me.body.mailgunDomainStatus)
        ? me.body.mailgunDomainStatus
        : "unknown";
      if (!domain || senderDomain !== domain) {
        return {
          status: "failed",
          detail: { domain: domain || null, senderDomain },
          message: "This address is not on the site's Paradise Modern sending domain.",
        };
      }
      return {
        status: status === "active" ? "verified" : "pending",
        detail: { domain, providerStatus: status },
        message: status === "active" ? undefined : `The sending domain is ${status} at Paradise Modern.`,
      };
    },
  };
}
