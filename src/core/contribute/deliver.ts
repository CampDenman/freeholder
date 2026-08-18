// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Spoke delivery of a submitted contribution (C1.32).
//
// The mutation never fetches. This job posts the same body `contribute.ingest`
// accepts, optionally signed with the webhook HMAC scheme, and records the
// hub's receipt id. A nested MCP client is not a thing this product has.
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { signPayload } from "@/core/webhooks/sign";
import { contributions } from "./schema";

export const DEFAULT_HUB_URL = "https://freeholder.ai";
const DELIVER_TIMEOUT_MS = 10_000;

export interface ContributeSettingsView {
  hubEnabled: boolean;
  hubUrl: string;
  hasReceiveSecret: boolean;
  receiveSecret: string | null;
}

export function normalizeHubUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export function isSelfHub(hubUrl: string, appUrl = env().APP_URL): boolean {
  const trimmed = normalizeHubUrl(hubUrl);
  if (!trimmed) return true;
  try {
    return new URL(trimmed).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

/** The project's own site is a hub unless an operator turns ingest off. */
export function isCanonicalProjectHub(appUrl = env().APP_URL): boolean {
  try {
    const host = new URL(appUrl).hostname.toLowerCase();
    return host === "freeholder.ai" || host === "www.freeholder.ai";
  } catch {
    return false;
  }
}

export function recordStatusUrl(appUrl = env().APP_URL): string {
  return `${normalizeHubUrl(appUrl)}/api/v1/contribute.recordStatus`;
}

export function ingestUrl(hubUrl: string): string {
  return `${normalizeHubUrl(hubUrl)}/api/v1/contribute.ingest`;
}

export interface SpokeDeliveryBody {
  kind: string;
  title: string;
  body: string;
  locale: string;
  email?: string;
  name?: string;
  includeDoctor: boolean;
  doctorReport?: unknown;
  platformVersion?: string | null;
  dcoAttested: boolean;
  dcoSigner?: string | null;
  externalUrl?: string | null;
  contentHash: string;
  source: "spoke";
  spokeId?: string;
  replyUrl?: string;
  replyToken?: string;
}

export function spokeBodyFromRow(row: {
  kind: string;
  title: string;
  body: string;
  locale: string;
  reporterEmail?: string | null;
  reporterName?: string | null;
  includeDoctor: boolean;
  doctorReport?: unknown;
  platformVersion?: string | null;
  dcoAttested: boolean;
  dcoSigner?: string | null;
  externalUrl?: string | null;
  contentHash: string;
  id?: string;
  replyUrl?: string | null;
  replyToken?: string | null;
}): SpokeDeliveryBody {
  return {
    kind: row.kind,
    title: row.title,
    body: row.body,
    locale: row.locale,
    email: row.reporterEmail ?? undefined,
    name: row.reporterName ?? undefined,
    includeDoctor: row.includeDoctor,
    doctorReport: row.includeDoctor ? row.doctorReport : undefined,
    platformVersion: row.platformVersion,
    dcoAttested: row.dcoAttested,
    dcoSigner: row.dcoSigner,
    externalUrl: row.externalUrl,
    contentHash: row.contentHash,
    source: "spoke",
    spokeId: row.id,
    replyUrl: row.replyUrl ?? undefined,
    replyToken: row.replyToken ?? undefined,
  };
}

export function spokeBodyJson(row: Parameters<typeof spokeBodyFromRow>[0]): string {
  return JSON.stringify(spokeBodyFromRow(row));
}

export interface DeliveryResult {
  id: string;
  status: "delivered" | "skipped" | "received";
  hubReceiptId?: string;
}

export async function deliverQueuedContribution(
  contributionId: string,
  options: {
    hubUrl: string;
    hubSecret?: string | null;
    fetchImpl?: typeof fetch;
  },
): Promise<DeliveryResult> {
  const [row] = await db()
    .select()
    .from(contributions)
    .where(eq(contributions.id, contributionId))
    .limit(1);
  if (!row) {
    return { id: contributionId, status: "skipped" };
  }
  if (row.status !== "queued") {
    return { id: row.id, status: "skipped" };
  }
  if (isSelfHub(options.hubUrl)) {
    await db()
      .update(contributions)
      .set({ status: "received" })
      .where(eq(contributions.id, row.id));
    return { id: row.id, status: "received" };
  }

  const payload = spokeBodyJson(row);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (options.hubSecret) {
    headers["freeholder-signature"] = signPayload(
      options.hubSecret,
      payload,
      Math.floor(Date.now() / 1000),
    );
    headers["freeholder-event"] = "contribute.submitted";
    headers["freeholder-delivery"] = row.id;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVER_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(ingestUrl(options.hubUrl), {
      method: "POST",
      headers,
      body: payload,
      redirect: "manual",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (response.status >= 500 || response.status === 429) {
    throw new Error(`Hub ingest returned ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`Hub ingest refused the report (${response.status}).`);
  }

  const json = (await response.json().catch(() => null)) as
    | { id?: string }
    | null;
  const hubReceiptId = json?.id;
  await db()
    .update(contributions)
    .set({
      status: "delivered",
      hubReceiptId: hubReceiptId ?? null,
    })
    .where(eq(contributions.id, row.id));
  return { id: row.id, status: "delivered", hubReceiptId };
}

export interface StatusReplyBody {
  spokeId: string;
  replyToken: string;
  status: string;
  note?: string;
  checklistId?: string | null;
  hubId: string;
}

export async function deliverStatusReply(
  row: {
    id: string;
    spokeId: string | null;
    replyUrl: string | null;
    replyToken: string | null;
    status: string;
    checklistId: string | null;
  },
  note: string | undefined,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<{ sent: boolean }> {
  if (!row.replyUrl || !row.spokeId || !row.replyToken) {
    return { sent: false };
  }
  const payload: StatusReplyBody = {
    spokeId: row.spokeId,
    replyToken: row.replyToken,
    status: row.status,
    note,
    checklistId: row.checklistId,
    hubId: row.id,
  };
  const body = JSON.stringify(payload);
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVER_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(row.replyUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body,
      redirect: "manual",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (response.status >= 500 || response.status === 429) {
    throw new Error(`Spoke status reply returned ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`Spoke refused the status reply (${response.status}).`);
  }
  return { sent: true };
}
