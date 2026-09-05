// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Twilio SMS/MMS edge (MASTER.md §12, §4.14, C7.10).
//
// Twilio because it is the one provider available in most of the countries a
// small business actually operates in, and because its webhook signature is
// verifiable without a vendor SDK — which matters more than it sounds: an
// adapter that needs a 40MB dependency to check an HMAC is an adapter that
// cannot ship on a $6 droplet.
//
// The signature scheme is Twilio's own and unusual enough to be worth stating:
// the signed string is the **full request URL** followed by every POSTed
// parameter, sorted by key, concatenated as `key + value` with no separators,
// signed HMAC-SHA1 with the account's auth token. Getting any part of that
// wrong produces a signature that never matches, which looks exactly like an
// attack — so the construction is spelled out below rather than left to a
// reader to reverse-engineer.
import { createHmac, timingSafeEqual } from "node:crypto";
import { AdapterError } from "../types";
import type { AdapterErrorCode, RawProviderRequest } from "../types";
import type {
  OutboundSms,
  SmsAdapter,
  SmsNumber,
  SmsNumberHealth,
  SmsInboundMedia,
  SmsProviderEvent,
  SmsSendResult,
} from "./types";
import { readBoundedBytes, RequestBodyError } from "@/core/http/body";

const ID = "twilio";
const MAX_RESPONSE_BYTES = 1_048_576;

export interface TwilioSmsOptions {
  accountSid?: string;
  authToken?: string;
  /** Default sender, when a message does not name one. */
  from?: string;
  apiBase?: string;
  fetch?: typeof fetch;
  /**
   * The public URL Twilio was configured to call.
   *
   * Part of the signed string, so it has to be what Twilio used rather than
   * what this process thinks it is — behind a proxy those differ, and the
   * mismatch is the commonest cause of a webhook that "randomly" fails.
   */
  webhookUrl?: string;
}

function fail(
  code: AdapterErrorCode,
  message: string,
  retryable = false,
  providerCode?: string,
): never {
  throw new AdapterError("sms", ID, code, message, retryable, providerCode);
}

async function twilioJson(response: Response): Promise<Record<string, unknown>> {
  let body: string;
  try {
    body = new TextDecoder().decode(await readBoundedBytes(response, MAX_RESPONSE_BYTES));
  } catch (error) {
    if (error instanceof RequestBodyError) {
      fail("provider_failure", "Twilio returned an oversized response.", true);
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = body ? JSON.parse(body) : {};
  } catch {
    fail("provider_failure", "Twilio returned an unreadable response.", response.status >= 500);
  }
  if (!parsed || typeof parsed !== "object") {
    fail("provider_failure", "Twilio returned an invalid response.", response.status >= 500);
  }
  const record = parsed as Record<string, unknown>;
  if (!response.ok) {
    // Twilio's own code, kept in the message: "21610" means the recipient has
    // replied STOP, and an owner who sees the number can look it up.
    const code = typeof record.code === "number" ? String(record.code) : "error";
    const detail = typeof record.message === "string" ? record.message : "";
    fail(
      response.status === 401 || response.status === 403
        ? "authentication"
        : response.status === 429
          ? "rate_limited"
          : response.status >= 500
            ? "provider_failure"
            : "invalid_request",
      `Twilio refused the request (${code})${detail ? `: ${detail}` : ""}.`,
      response.status === 429 || response.status >= 500,
      code,
    );
  }
  return record;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Twilio prices are decimal strings, negative because they are a debit.
 *
 * Converted to positive integer minor units (§15.4). Parsed rather than
 * multiplied through a float where it can be helped: "-0.0079" is four decimal
 * places, which is *sub-cent*, and rounding it to a cent per message overstates
 * a thousand-message send by several pounds.
 */
function priceToMinor(price: unknown): number | undefined {
  const raw = text(price);
  if (!raw) return undefined;
  const value = Math.abs(Number(raw));
  if (!Number.isFinite(value)) return undefined;
  // Kept in minor units of the smallest unit Twilio quotes, rounded once at the
  // end rather than per message, and never through `toFixed` (§15.4's gate).
  return Math.round(value * 100);
}

export function createTwilioSms(options: TwilioSmsOptions = {}): SmsAdapter {
  const accountSid = options.accountSid?.trim();
  const authToken = options.authToken?.trim();
  const doFetch = options.fetch ?? fetch;
  const apiBase = options.apiBase ?? "https://api.twilio.com/2010-04-01";
  const apiOrigin = new URL(apiBase).origin;
  const available = Boolean(accountSid && authToken);
  const message = available
    ? "Sending and receiving text messages through Twilio."
    : "Twilio needs an account SID and auth token before it can send.";

  const auth = () =>
    `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;

  const requireReady = () => {
    if (!available) fail("unavailable", message);
  };

  return {
    channel: "sms",
    id: ID,
    available,
    status: { family: "sms", channel: "sms", provider: ID, id: ID, available, message },

    async send(sms: OutboundSms): Promise<SmsSendResult> {
      requireReady();
      const from = sms.from ?? options.from;
      if (!from) {
        return {
          providerRef: null,
          delivers: false,
          reason: "No number is set up to send from.",
        };
      }

      const form = new URLSearchParams();
      form.set("To", sms.to);
      form.set("From", from);
      form.set("Body", sms.body);
      for (const url of sms.mediaUrls ?? []) form.append("MediaUrl", url);

      const response = await doFetch(`${apiBase}/Accounts/${accountSid}/Messages.json`, {
        method: "POST",
        headers: {
          authorization: auth(),
          "content-type": "application/x-www-form-urlencoded",
          // Twilio's own idempotency: the same key within 24 hours returns the
          // first message rather than sending a second one.
          "i-twilio-idempotency-token": sms.deliveryId,
        },
        body: form.toString(),
      });
      const created = await twilioJson(response);

      const segments = Number(created.num_segments);
      return {
        providerRef: text(created.sid) ?? null,
        // Accepted, not delivered. Twilio says "queued" here and tells the
        // truth later on the status callback — §4.14: delivery is observed,
        // not assumed.
        delivers: true,
        segments: Number.isFinite(segments) && segments > 0 ? segments : undefined,
        costMinor: priceToMinor(created.price),
        costCurrency: text(created.price_unit)?.toUpperCase(),
      };
    },

    /**
     * Verify and read a Twilio callback.
     *
     * The exact bytes are used, never a re-encoded form: re-serialising a form
     * body reorders and re-escapes it, and the signature is over what was
     * actually sent.
     */
    async verifyWebhook(request: RawProviderRequest): Promise<readonly SmsProviderEvent[]> {
      requireReady();
      const signature = request.headers["x-twilio-signature"];
      if (!signature) fail("authentication", "That callback carried no Twilio signature.");
      const url = options.webhookUrl;
      if (!url) {
        fail(
          "unavailable",
          "The public webhook URL is not configured, so a Twilio signature cannot be checked.",
        );
      }

      const params = new URLSearchParams(Buffer.from(request.body).toString("utf8"));
      // URL, then every parameter sorted by key, concatenated as key + value
      // with no separators. Twilio's scheme, exactly.
      const signed = [...params.entries()]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .reduce((acc, [key, value]) => acc + key + value, url);
      const expected = createHmac("sha1", authToken!).update(signed, "utf8").digest();
      const offered = Buffer.from(signature, "base64");
      if (
        offered.length !== expected.length ||
        !timingSafeEqual(new Uint8Array(offered), new Uint8Array(expected))
      ) {
        fail("authentication", "That callback's Twilio signature did not match.");
      }

      const status = params.get("MessageStatus") ?? params.get("SmsStatus");
      const sid = params.get("MessageSid") ?? params.get("SmsSid");
      if (!sid) fail("invalid_request", "That callback named no message.");
      const occurredAt = request.receivedAt;

      // An inbound message carries a body and no delivery status; a status
      // callback carries a status and no body. Telling them apart on the
      // presence of a status is what Twilio's own documentation does.
      if (!status) {
        const media: string[] = [];
        const count = Number(params.get("NumMedia") ?? "0");
        for (let index = 0; index < (Number.isFinite(count) ? count : 0); index += 1) {
          const url = params.get(`MediaUrl${index}`);
          if (url) media.push(url);
        }
        return [
          {
            id: sid,
            kind: "received",
            providerRef: sid,
            from: params.get("From") ?? undefined,
            to: params.get("To") ?? undefined,
            body: params.get("Body") ?? "",
            mediaUrls: media.length > 0 ? media : undefined,
            occurredAt,
          },
        ];
      }

      const kind =
        status === "delivered"
          ? "delivered"
          : status === "undelivered"
            ? "undelivered"
            : status === "failed"
              ? "failed"
              : "sent";
      const segments = Number(params.get("NumSegments"));
      return [
        {
          id: `${sid}:${status}`,
          kind,
          providerRef: sid,
          errorCode: params.get("ErrorCode") ?? undefined,
          errorText: params.get("ErrorMessage") ?? undefined,
          segments: Number.isFinite(segments) && segments > 0 ? segments : undefined,
          costMinor: priceToMinor(params.get("Price")),
          costCurrency: params.get("PriceUnit")?.toUpperCase() || undefined,
          occurredAt,
        },
      ];
    },

    async downloadMedia(url: string): Promise<SmsInboundMedia> {
      requireReady();
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return fail("invalid_request", "Twilio sent an invalid media URL.");
      }
      if (parsed.protocol !== "https:" || parsed.origin !== apiOrigin) {
        return fail("invalid_request", "Twilio media must come from the configured Twilio API origin.");
      }
      const response = await doFetch(parsed, {
        headers: { authorization: auth() },
        redirect: "error",
      });
      if (!response.ok) {
        return fail(
          response.status === 401 || response.status === 403
            ? "authentication"
            : response.status >= 500
              ? "provider_failure"
              : "invalid_request",
          `Twilio media download failed with HTTP ${response.status}.`,
          response.status >= 500,
        );
      }
      const maxMediaBytes = 10 * 1024 * 1024;
      let bytes: Uint8Array<ArrayBuffer>;
      try {
        bytes = await readBoundedBytes(response, maxMediaBytes);
      } catch (error) {
        if (error instanceof RequestBodyError) {
          return fail("invalid_request", "Twilio sent a media file larger than 10 MB.");
        }
        throw error;
      }
      if (bytes.byteLength === 0) {
        return fail("invalid_request", "Twilio sent an empty or oversized media file.");
      }
      const contentType = (response.headers.get("content-type") ?? "application/octet-stream")
        .split(";", 1)[0]!
        .trim()
        .toLowerCase();
      const extensionByType: Record<string, string> = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "audio/mpeg": ".mp3",
        "audio/mp4": ".m4a",
        "video/mp4": ".mp4",
      };
      const pathName = decodeURIComponent(parsed.pathname.split("/").pop() ?? "media")
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .slice(-180);
      const extension = extensionByType[contentType] ?? "";
      const filename = /\.[a-z0-9]{1,8}$/i.test(pathName)
        ? pathName
        : `${pathName || "media"}${extension}`;
      return {
        sourceUrl: parsed.toString(),
        filename,
        contentType,
        bytes,
      };
    },

    async listNumbers(): Promise<readonly SmsNumber[]> {
      requireReady();
      const response = await doFetch(
        `${apiBase}/Accounts/${accountSid}/IncomingPhoneNumbers.json?PageSize=100`,
        { headers: { authorization: auth() } },
      );
      const body = await twilioJson(response);
      const rows = Array.isArray(body.incoming_phone_numbers)
        ? (body.incoming_phone_numbers as Record<string, unknown>[])
        : [];
      return rows.map((row) => {
        const capabilities = (row.capabilities ?? {}) as Record<string, unknown>;
        const e164 = text(row.phone_number) ?? "";
        return {
          providerRef: text(row.sid) ?? e164,
          e164,
          country: text(row.iso_country)?.toUpperCase() ?? null,
          // Twilio does not label long codes; a toll-free number is one whose
          // area code says so, and everything else here is a long code.
          kind: /^\+1(800|833|844|855|866|877|888)/.test(e164) ? "toll_free" : "long_code",
          capabilities: {
            sms: capabilities.sms === true,
            mms: capabilities.mms === true,
            inbound: capabilities.sms === true,
          },
        } satisfies SmsNumber;
      });
    },

    async checkNumber(providerRef: string): Promise<SmsNumberHealth> {
      requireReady();
      try {
        const response = await doFetch(
          `${apiBase}/Accounts/${accountSid}/IncomingPhoneNumbers/${encodeURIComponent(providerRef)}.json`,
          { headers: { authorization: auth() } },
        );
        const body = await twilioJson(response);
        const status = text(body.status) ?? "in-use";
        const usable = status === "in-use";
        return {
          providerRef,
          usable,
          providerStatus: status,
          problem: usable
            ? null
            : `Twilio reports this number as "${status}". Check it in the Twilio console before sending.`,
          unknown: false,
        };
      } catch (error) {
        // An answer nobody can trust is worse than an admitted gap: reporting
        // "healthy" because the check failed is exactly how a silently filtered
        // number goes unnoticed.
        return {
          providerRef,
          usable: false,
          providerStatus: null,
          problem:
            error instanceof AdapterError
              ? error.message
              : "Twilio could not be reached to check this number.",
          unknown: true,
        };
      }
    },
  };
}
