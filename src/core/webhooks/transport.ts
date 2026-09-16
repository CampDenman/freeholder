// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// DNS-safe, address-pinned webhook transport. Redirects are never followed.
import { lookup as systemLookup } from "node:dns/promises";
import { request as requestHttp } from "node:http";
import { request as requestHttps, type RequestOptions } from "node:https";
import { isIP } from "node:net";
import { isPublicIpAddress, normalizeIpAddress } from "@/core/webhooks/address";
import { assertDeliverableUrl, type UrlCheckOptions } from "@/core/webhooks/sign";

export interface LookupAddress {
  address: string;
  family: 4 | 6;
}

export type WebhookLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<readonly LookupAddress[]>;

export interface ResolvedWebhookTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

export interface WebhookTransportOptions extends UrlCheckOptions {
  lookup?: WebhookLookup;
  dnsTimeoutMs?: number;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

function positiveTimeout(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number of milliseconds.`);
  }
  return value;
}

async function within<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function resolveWebhookTarget(
  raw: string,
  options: WebhookTransportOptions = {},
): Promise<ResolvedWebhookTarget> {
  const url = assertDeliverableUrl(raw, options);
  const hostname = normalizeIpAddress(url.hostname);
  const literalFamily = isIP(hostname);
  let answers: readonly LookupAddress[];
  if (literalFamily === 4 || literalFamily === 6) {
    answers = [{ address: hostname, family: literalFamily }];
  } else {
    const lookup = options.lookup ?? (systemLookup as WebhookLookup);
    const dnsTimeoutMs = positiveTimeout(
      options.dnsTimeoutMs ?? Math.min(options.timeoutMs ?? 10_000, 5_000),
      "dnsTimeoutMs",
    );
    try {
      answers = await within(
        lookup(hostname, { all: true, verbatim: true }),
        dnsTimeoutMs,
        "The webhook hostname resolution timed out.",
      );
    } catch {
      throw new Error("The webhook hostname could not be resolved.");
    }
  }
  if (answers.length === 0) throw new Error("The webhook hostname returned no addresses.");

  const normalized = answers.map((answer) => ({
    address: normalizeIpAddress(answer.address),
    family: answer.family,
  }));
  if (normalized.some((answer) => isIP(answer.address) !== answer.family)) {
    throw new Error("The webhook hostname returned an invalid address record.");
  }
  const allowLocal =
    process.env.NODE_ENV !== "production" && options.allowLocal !== false;
  if (!allowLocal && normalized.some((answer) => !isPublicIpAddress(answer.address))) {
    // Refuse the whole answer set. Picking only the public answer would let an
    // attacker influence which address a later resolver or retry uses.
    throw new Error("The webhook hostname resolved to a prohibited network address.");
  }
  const selected = normalized[0]!;
  return { url, address: selected.address, family: selected.family };
}

export function pinnedRequestOptions(
  target: ResolvedWebhookTarget,
  headers: Record<string, string>,
): RequestOptions {
  const originalHostname = normalizeIpAddress(target.url.hostname);
  return {
    protocol: target.url.protocol,
    hostname: target.address,
    family: target.family,
    port: target.url.port || undefined,
    method: "POST",
    path: `${target.url.pathname}${target.url.search}`,
    // A fresh connection ensures an agent cannot reuse a socket associated
    // with a different hostname or an address that was not just checked.
    agent: false,
    servername: isIP(originalHostname) ? undefined : originalHostname,
    headers: { ...headers, host: target.url.host },
  };
}

export async function postWebhook(
  raw: string,
  body: string,
  headers: Record<string, string>,
  options: WebhookTransportOptions = {},
): Promise<{ status: number; body: string }> {
  const startedAt = Date.now();
  const timeoutMs = positiveTimeout(options.timeoutMs ?? 10_000, "timeoutMs");
  const target = await resolveWebhookTarget(raw, options);
  const request = target.url.protocol === "https:" ? requestHttps : requestHttp;
  const maxResponseBytes = options.maxResponseBytes ?? 2_000;
  const remainingMs = timeoutMs - (Date.now() - startedAt);
  if (remainingMs <= 0) throw new Error(`No answer within ${timeoutMs / 1000} seconds.`);

  return new Promise((resolveResponse, rejectResponse) => {
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      operation();
    };
    const outgoing = request(
      pinnedRequestOptions(target, {
        ...headers,
        "content-length": String(Buffer.byteLength(body)),
      }),
      (incoming) => {
        const chunks: Buffer[] = [];
        let received = 0;
        incoming.on("data", (chunk: Buffer | string) => {
          if (settled) return;
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          const remaining = Math.max(0, maxResponseBytes - received);
          if (remaining > 0) chunks.push(bytes.subarray(0, remaining));
          received += bytes.byteLength;
          if (received >= maxResponseBytes) {
            finish(() => resolveResponse({
              status: incoming.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
            }));
            incoming.destroy();
          }
        });
        incoming.on("end", () => {
          finish(() => resolveResponse({
            status: incoming.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }));
        });
        incoming.on("error", (error) => finish(() => rejectResponse(error)));
      },
    );
    const deadline = setTimeout(() => {
      outgoing.destroy(new Error(`No answer within ${timeoutMs / 1000} seconds.`));
    }, remainingMs);
    outgoing.on("error", (error) => finish(() => rejectResponse(error)));
    outgoing.end(body);
  });
}
