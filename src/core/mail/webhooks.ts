// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Authenticated delivery feedback for Resend, Postmark and Amazon SES.
// Raw provider bodies are held only long enough to authenticate and normalize;
// the database receives a SHA-256 digest and bounded, vocabulary-only detail.
import {
  X509Certificate,
  createHash,
  createHmac,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";
import { z } from "zod";
import { boundedText, requestWithTimeout } from "@/adapters/mail/http";
import { env } from "@/core/env";
import {
  recordMailProviderEvent,
  type NormalizedProviderEvent,
} from "@/core/mail/service";

const MAX_WEBHOOK_BYTES = 256 * 1024;
const MAX_CERTIFICATE_BYTES = 64 * 1024;
const RESEND_CLOCK_SKEW_SECONDS = 5 * 60;
const emailAddress = z.string().trim().email().toLowerCase().max(320);
const isoDate = z.iso.datetime();

export class MailWebhookError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 503 = 400,
  ) {
    super(message);
    this.name = "MailWebhookError";
  }
}

async function boundedBody(request: Request): Promise<Buffer> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) {
    throw new MailWebhookError("Webhook payload is too large.");
  }
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_WEBHOOK_BYTES) {
      await reader.cancel();
      throw new MailWebhookError("Webhook payload is too large.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, bytes);
}

function digest(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

function equalSecretText(left: string, right: string): boolean {
  // Hash both sides first so credential length does not create a fast-fail
  // comparison path. The hash is local and fixed-size; the raw Basic value is
  // never logged or persisted.
  const leftHash = createHash("sha256").update(left, "utf8").digest();
  const rightHash = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftHash, rightHash);
}

function jsonObject(body: Buffer): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(body.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new MailWebhookError("Webhook payload is not valid JSON.");
  }
}

function requiredString(
  object: Record<string, unknown>,
  key: string,
  max = 500,
): string {
  const value = object[key];
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new MailWebhookError(`Webhook field ${key} is invalid.`);
  }
  return value;
}

function eventDate(value: unknown): string {
  const parsed = isoDate.safeParse(value);
  if (!parsed.success) {
    throw new MailWebhookError("Webhook event time is invalid.");
  }
  return parsed.data;
}

function webhookEmail(value: unknown, provider: string): string {
  const parsed = emailAddress.safeParse(value);
  if (!parsed.success) {
    throw new MailWebhookError(`${provider} webhook recipient is invalid.`);
  }
  return parsed.data;
}

async function record(event: NormalizedProviderEvent): Promise<void> {
  await recordMailProviderEvent.call(event, { kind: "system" });
}

function configured(value: string | undefined, name: string): string {
  if (!value) {
    throw new MailWebhookError(
      `${name} is not configured for this endpoint.`,
      503,
    );
  }
  return value;
}

// -- Resend / Svix ---------------------------------------------------------

export function verifyResendSignature(input: {
  body: Uint8Array;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  secret: string;
  nowSeconds?: number;
}): string {
  if (
    !input.id ||
    input.id.length > 200 ||
    !input.timestamp ||
    !/^\d{10}$/.test(input.timestamp) ||
    !input.signature ||
    input.signature.length > 2000
  ) {
    throw new MailWebhookError("Resend webhook authentication is missing.", 401);
  }
  const timestamp = Number(input.timestamp);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > RESEND_CLOCK_SKEW_SECONDS) {
    throw new MailWebhookError("Resend webhook timestamp is stale.", 401);
  }
  const encodedSecret = input.secret.startsWith("whsec_")
    ? input.secret.slice("whsec_".length)
    : input.secret;
  let key: Buffer;
  try {
    key = Buffer.from(encodedSecret, "base64");
  } catch {
    throw new MailWebhookError("RESEND_WEBHOOK_SECRET is invalid.", 503);
  }
  if (key.byteLength < 16) {
    throw new MailWebhookError("RESEND_WEBHOOK_SECRET is invalid.", 503);
  }
  const mac = createHmac("sha256", key);
  mac.update(`${input.id}.${input.timestamp}.`, "utf8");
  mac.update(input.body);
  const expected = mac.digest();
  const valid = input.signature
    .trim()
    .split(/\s+/)
    .some((candidate) => {
      const match = /^v1,([A-Za-z0-9+/]+={0,2})$/.exec(candidate);
      if (!match) return false;
      return equal(Buffer.from(match[1]!, "base64"), expected);
    });
  if (!valid) {
    throw new MailWebhookError("Resend webhook signature is invalid.", 401);
  }
  return input.id;
}

export async function processResendWebhook(request: Request): Promise<number> {
  const body = await boundedBody(request);
  const id = verifyResendSignature({
    body,
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
    secret: configured(env().RESEND_WEBHOOK_SECRET, "RESEND_WEBHOOK_SECRET"),
  });
  const payload = jsonObject(body);
  const type = requiredString(payload, "type", 100);
  const data = payload.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new MailWebhookError("Resend webhook data is invalid.");
  }
  const fields = data as Record<string, unknown>;
  const providerRef = requiredString(fields, "email_id");
  const occurredAt = eventDate(payload.created_at);
  const mapped: NormalizedProviderEvent["eventType"] | undefined =
    type === "email.sent"
      ? "submitted"
      : type === "email.delivered"
        ? "delivered"
        : type === "email.delivery_delayed"
          ? "delayed"
          : type === "email.bounced"
            // Resend documents this event as a permanent rejection.
            ? "hard_bounce"
            : type === "email.complained"
              ? "complaint"
              : type === "email.suppressed"
                ? "suppressed"
                : type === "email.failed"
                  ? "failed"
                  : undefined;
  if (!mapped) return 0;
  const rawRecipients = Array.isArray(fields.to) ? fields.to : [fields.to];
  const recipients = rawRecipients
    .slice(0, 100)
    .map((value) => emailAddress.safeParse(value))
    .filter((value): value is { success: true; data: string } => value.success)
    .map((value) => value.data);
  if (recipients.length === 0) {
    throw new MailWebhookError("Resend webhook has no valid recipient.");
  }
  const rawDigest = digest(body);
  for (const [index, recipient] of recipients.entries()) {
    await record({
      provider: "resend",
      externalEventId: `${id}:${index}`,
      providerRef,
      recipient,
      eventType: mapped,
      detail: `Resend ${type.slice("email.".length).replaceAll("_", " ")}`,
      rawDigest,
      occurredAt,
    });
  }
  return recipients.length;
}

// -- Postmark --------------------------------------------------------------

export function verifyPostmarkAuthorization(
  authorization: string | null,
  user: string,
  password: string,
): void {
  const expected = `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;
  if (!equalSecretText(authorization ?? "", expected)) {
    // Postmark stops retries on 403, which is appropriate for a configuration
    // mismatch that will not become valid by sending the same payload again.
    throw new MailWebhookError("Postmark webhook authentication failed.", 403);
  }
}

export async function processPostmarkWebhook(request: Request): Promise<number> {
  const current = env();
  verifyPostmarkAuthorization(
    request.headers.get("authorization"),
    configured(current.POSTMARK_WEBHOOK_USER, "POSTMARK_WEBHOOK_USER"),
    configured(current.POSTMARK_WEBHOOK_PASSWORD, "POSTMARK_WEBHOOK_PASSWORD"),
  );
  const body = await boundedBody(request);
  const payload = jsonObject(body);
  const type = requiredString(payload, "RecordType", 80);
  const providerRef =
    typeof payload.MessageID === "string" && payload.MessageID.length <= 500
      ? payload.MessageID
      : undefined;
  let recipient: string;
  let occurredAt: string;
  let eventType: NormalizedProviderEvent["eventType"];
  let detail: string;

  if (type === "Delivery") {
    recipient = webhookEmail(payload.Recipient, "Postmark");
    occurredAt = eventDate(payload.DeliveredAt);
    eventType = "delivered";
    detail = "Postmark delivery";
  } else if (type === "Bounce") {
    recipient = webhookEmail(payload.Email, "Postmark");
    occurredAt = eventDate(payload.BouncedAt);
    const bounceType =
      typeof payload.Type === "string"
        ? payload.Type
        : typeof payload.BounceType === "string"
          ? payload.BounceType
          : "";
    const hard =
      payload.Inactive === true ||
      payload.TypeCode === 1 ||
      bounceType === "HardBounce";
    eventType = hard ? "hard_bounce" : "soft_bounce";
    detail = hard ? "Postmark hard bounce" : "Postmark soft bounce";
  } else if (type === "SpamComplaint") {
    recipient = webhookEmail(payload.Email, "Postmark");
    occurredAt = eventDate(payload.BouncedAt ?? payload.ReceivedAt);
    eventType = "complaint";
    detail = "Postmark spam complaint";
  } else if (type === "SubscriptionChange") {
    recipient = webhookEmail(payload.Recipient, "Postmark");
    occurredAt = eventDate(payload.ChangedAt);
    if (payload.SuppressSending === true) {
      eventType =
        payload.SuppressionReason === "SpamComplaint"
          ? "complaint"
          : payload.SuppressionReason === "HardBounce"
            ? "hard_bounce"
            : "suppressed";
      detail = "Postmark suppression activated";
    } else {
      // Provider reactivation is evidence, not authority to undo Freeholder's
      // local safety choice. A person must still release the exact address.
      eventType = "delayed";
      detail = "Postmark suppression removed; local release still required";
    }
  } else {
    return 0;
  }
  const rawDigest = digest(body);
  await record({
    provider: "postmark",
    externalEventId: `postmark:${rawDigest}`,
    providerRef,
    recipient,
    eventType,
    detail,
    rawDigest,
    occurredAt,
  });
  return 1;
}

// -- Amazon SNS / SES ------------------------------------------------------

type SnsMessage = {
  Type: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: "2";
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  Token?: string;
  SubscribeURL?: string;
};

const certificateCache = new Map<
  string,
  { certificate: X509Certificate; expiresAt: number }
>();

function snsHost(hostname: string): boolean {
  return (
    hostname === "sns.amazonaws.com" ||
    /^sns\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?$/.test(hostname)
  );
}

function trustedSnsUrl(raw: string, certificate = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new MailWebhookError("Amazon SNS URL is invalid.", 403);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !snsHost(url.hostname)
  ) {
    throw new MailWebhookError("Amazon SNS URL source is not trusted.", 403);
  }
  if (
    certificate &&
    (url.search !== "" ||
      url.hash !== "" ||
      !/^\/SimpleNotificationService-[A-Za-z0-9_-]{20,200}\.pem$/.test(
        url.pathname,
      ))
  ) {
    throw new MailWebhookError("Amazon SNS signing certificate URL is invalid.", 403);
  }
  return url;
}

function snsMessage(payload: Record<string, unknown>): SnsMessage {
  const type = requiredString(payload, "Type", 40);
  if (
    type !== "Notification" &&
    type !== "SubscriptionConfirmation" &&
    type !== "UnsubscribeConfirmation"
  ) {
    throw new MailWebhookError("Amazon SNS message type is invalid.");
  }
  if (payload.SignatureVersion !== "2") {
    throw new MailWebhookError(
      "Amazon SNS must use SignatureVersion 2 (SHA-256).",
      403,
    );
  }
  const message: SnsMessage = {
    Type: type,
    MessageId: requiredString(payload, "MessageId"),
    TopicArn: requiredString(payload, "TopicArn"),
    Message: requiredString(payload, "Message", MAX_WEBHOOK_BYTES),
    Timestamp: eventDate(payload.Timestamp),
    SignatureVersion: "2",
    Signature: requiredString(payload, "Signature", 4000),
    SigningCertURL: requiredString(payload, "SigningCertURL", 2000),
  };
  if (typeof payload.Subject === "string") message.Subject = payload.Subject;
  if (typeof payload.Token === "string") message.Token = payload.Token;
  if (typeof payload.SubscribeURL === "string") {
    message.SubscribeURL = payload.SubscribeURL;
  }
  return message;
}

function snsStringToSign(message: SnsMessage): string {
  const fields: Array<[string, string | undefined]> =
    message.Type === "Notification"
      ? [
          ["Message", message.Message],
          ["MessageId", message.MessageId],
          ["Subject", message.Subject],
          ["Timestamp", message.Timestamp],
          ["TopicArn", message.TopicArn],
          ["Type", message.Type],
        ]
      : [
          ["Message", message.Message],
          ["MessageId", message.MessageId],
          ["SubscribeURL", message.SubscribeURL],
          ["Timestamp", message.Timestamp],
          ["Token", message.Token],
          ["TopicArn", message.TopicArn],
          ["Type", message.Type],
        ];
  return fields
    .filter((field): field is [string, string] => field[1] !== undefined)
    .map(([name, value]) => `${name}\n${value}\n`)
    .join("");
}

async function snsCertificate(
  rawUrl: string,
  fetcher: typeof globalThis.fetch,
): Promise<X509Certificate> {
  const url = trustedSnsUrl(rawUrl, true);
  const cached = certificateCache.get(url.toString());
  if (cached && cached.expiresAt > Date.now()) return cached.certificate;
  let response: Response;
  try {
    response = await requestWithTimeout(fetcher, url, {
      method: "GET",
      redirect: "error",
    });
  } catch {
    throw new MailWebhookError(
      "Amazon SNS signing certificate is unavailable.",
      503,
    );
  }
  if (!response.ok) {
    try {
      await boundedText(response);
    } catch {
      // The response is already unusable; keep provider detail out of the
      // route response and report the availability failure below.
    }
    throw new MailWebhookError("Amazon SNS signing certificate is unavailable.", 503);
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_CERTIFICATE_BYTES) {
    throw new MailWebhookError("Amazon SNS signing certificate is too large.", 403);
  }
  let pem: string;
  try {
    pem = await boundedText(response);
  } catch {
    throw new MailWebhookError("Amazon SNS signing certificate is too large.", 403);
  }
  if (Buffer.byteLength(pem) > MAX_CERTIFICATE_BYTES) {
    throw new MailWebhookError("Amazon SNS signing certificate is too large.", 403);
  }
  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(pem);
  } catch {
    throw new MailWebhookError("Amazon SNS signing certificate is invalid.", 403);
  }
  const validFrom = Date.parse(certificate.validFrom);
  const validTo = Date.parse(certificate.validTo);
  const subjectIsSns = certificate.checkHost("sns.amazonaws.com") !== undefined;
  const amazonIssuer = /(?:^|\n)(?:O=Amazon|CN=Amazon)/.test(certificate.issuer);
  const rsaKey = ["rsa", "rsa-pss"].includes(
    certificate.publicKey.asymmetricKeyType ?? "",
  );
  const rsaBits = certificate.publicKey.asymmetricKeyDetails?.modulusLength;
  if (
    !subjectIsSns ||
    !amazonIssuer ||
    !rsaKey ||
    !rsaBits ||
    rsaBits < 2048 ||
    !Number.isFinite(validFrom) ||
    !Number.isFinite(validTo) ||
    Date.now() < validFrom ||
    Date.now() > validTo
  ) {
    throw new MailWebhookError(
      "Amazon SNS signing certificate did not pass source and validity checks.",
      403,
    );
  }
  // `fetch` validates the HTTPS server certificate chain before this public
  // signing certificate can be read; the strict SNS hostname/path above binds
  // the downloaded bytes to AWS rather than an arbitrary message-supplied URL.
  if (certificateCache.size >= 8) certificateCache.clear();
  certificateCache.set(url.toString(), {
    certificate,
    expiresAt: Math.min(validTo, Date.now() + 24 * 60 * 60 * 1000),
  });
  return certificate;
}

export async function verifySnsMessage(
  payload: Record<string, unknown>,
  options: {
    topicArn: string;
    fetch?: typeof globalThis.fetch;
    headerTopicArn?: string | null;
    headerType?: string | null;
  },
): Promise<SnsMessage> {
  const message = snsMessage(payload);
  if (
    message.TopicArn !== options.topicArn ||
    (options.headerTopicArn && options.headerTopicArn !== message.TopicArn) ||
    (options.headerType && options.headerType !== message.Type)
  ) {
    throw new MailWebhookError("Amazon SNS topic or message type is not accepted.", 403);
  }
  const certificate = await snsCertificate(
    message.SigningCertURL,
    options.fetch ?? globalThis.fetch,
  );
  let signature: Buffer;
  try {
    signature = Buffer.from(message.Signature, "base64");
  } catch {
    throw new MailWebhookError("Amazon SNS signature is invalid.", 403);
  }
  if (
    signature.byteLength < 128 ||
    !verifySignature(
      "RSA-SHA256",
      Buffer.from(snsStringToSign(message), "utf8"),
      certificate.publicKey,
      signature,
    )
  ) {
    throw new MailWebhookError("Amazon SNS signature is invalid.", 403);
  }
  return message;
}

function sesRecipients(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const entries: unknown[] = value;
  return entries
    .slice(0, 100)
    .map((entry) => {
      const candidate =
        entry && typeof entry === "object" && !Array.isArray(entry)
          ? (entry as Record<string, unknown>).emailAddress
          : entry;
      return emailAddress.safeParse(candidate);
    })
    .filter((result): result is { success: true; data: string } => result.success)
    .map((result) => result.data);
}

function innerObject(
  object: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = object[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function confirmSnsSubscription(
  message: SnsMessage,
  fetcher: typeof globalThis.fetch,
): Promise<void> {
  if (!message.SubscribeURL || !message.Token) {
    throw new MailWebhookError("Amazon SNS subscription confirmation is incomplete.");
  }
  const url = trustedSnsUrl(message.SubscribeURL);
  if (
    url.pathname !== "/" ||
    url.hash !== "" ||
    url.searchParams.get("Action") !== "ConfirmSubscription" ||
    url.searchParams.get("TopicArn") !== message.TopicArn ||
    url.searchParams.get("Token") !== message.Token
  ) {
    throw new MailWebhookError("Amazon SNS subscription URL is invalid.", 403);
  }
  let response: Response;
  try {
    response = await requestWithTimeout(fetcher, url, {
      method: "GET",
      redirect: "error",
    });
    await boundedText(response);
  } catch {
    throw new MailWebhookError(
      "Amazon SNS subscription could not be confirmed.",
      503,
    );
  }
  if (!response.ok) {
    throw new MailWebhookError("Amazon SNS subscription could not be confirmed.", 503);
  }
}

export async function processSesWebhook(
  request: Request,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<number> {
  const body = await boundedBody(request);
  const payload = jsonObject(body);
  const topicArn = configured(env().SES_SNS_TOPIC_ARN, "SES_SNS_TOPIC_ARN");
  const sns = await verifySnsMessage(payload, {
    topicArn,
    fetch: fetcher,
    headerTopicArn: request.headers.get("x-amz-sns-topic-arn"),
    headerType: request.headers.get("x-amz-sns-message-type"),
  });
  if (sns.Type === "SubscriptionConfirmation") {
    await confirmSnsSubscription(sns, fetcher);
    return 0;
  }
  if (sns.Type === "UnsubscribeConfirmation") return 0;

  let ses: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(sns.Message);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    ses = parsed as Record<string, unknown>;
  } catch {
    throw new MailWebhookError("Amazon SES notification is invalid.");
  }
  const type = requiredString(ses, "notificationType", 80);
  const mail = innerObject(ses, "mail");
  const providerRef = requiredString(mail, "messageId");
  let recipients: string[] = [];
  let eventType: NormalizedProviderEvent["eventType"];
  let detail: string;
  let occurredAt: string;

  if (type === "Bounce") {
    const bounce = innerObject(ses, "bounce");
    recipients = sesRecipients(bounce.bouncedRecipients);
    const permanent = bounce.bounceType === "Permanent";
    eventType = permanent ? "hard_bounce" : "soft_bounce";
    detail = permanent ? "Amazon SES permanent bounce" : "Amazon SES transient bounce";
    occurredAt = eventDate(bounce.timestamp ?? mail.timestamp ?? sns.Timestamp);
  } else if (type === "Complaint") {
    const complaint = innerObject(ses, "complaint");
    recipients = sesRecipients(complaint.complainedRecipients);
    eventType = "complaint";
    detail = "Amazon SES complaint";
    occurredAt = eventDate(complaint.timestamp ?? mail.timestamp ?? sns.Timestamp);
  } else if (type === "Delivery") {
    const delivery = innerObject(ses, "delivery");
    recipients = sesRecipients(delivery.recipients);
    eventType = "delivered";
    detail = "Amazon SES delivery";
    occurredAt = eventDate(delivery.timestamp ?? mail.timestamp ?? sns.Timestamp);
  } else if (type === "DeliveryDelay") {
    const delay = innerObject(ses, "deliveryDelay");
    recipients = sesRecipients(delay.delayedRecipients ?? mail.destination);
    eventType = "delayed";
    detail = "Amazon SES delivery delayed";
    occurredAt = eventDate(delay.timestamp ?? mail.timestamp ?? sns.Timestamp);
  } else if (type === "Send") {
    recipients = sesRecipients(mail.destination);
    eventType = "submitted";
    detail = "Amazon SES submitted";
    occurredAt = eventDate(mail.timestamp ?? sns.Timestamp);
  } else if (type === "Reject" || type === "Rendering Failure") {
    recipients = sesRecipients(mail.destination);
    eventType = "failed";
    detail = `Amazon SES ${type === "Reject" ? "rejection" : "rendering failure"}`;
    occurredAt = eventDate(mail.timestamp ?? sns.Timestamp);
  } else {
    return 0;
  }
  if (recipients.length === 0) {
    throw new MailWebhookError("Amazon SES notification has no valid recipient.");
  }
  const rawDigest = digest(body);
  for (const [index, recipient] of recipients.entries()) {
    await record({
      provider: "ses",
      externalEventId: `${sns.MessageId}:${index}`,
      providerRef,
      recipient,
      eventType,
      detail,
      rawDigest,
      occurredAt,
    });
  }
  return recipients.length;
}

export function resetMailWebhookCachesForTests(): void {
  certificateCache.clear();
}
