// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Workforce adapter selection (C4.05): a managed connection names an adapter,
// optionally a model, and the *name* of the environment variable holding its
// key (§17 — secrets live in the environment; the database stores the
// indirection so the admin and doctor can talk about it).
import { env } from "@/core/env";
import { anthropicWorkforceAdapter, ANTHROPIC_DEFAULT_MODEL } from "./workforce-anthropic";
import { openAiCompatibleWorkforceAdapter } from "./workforce-openai";
import {
  WORKFORCE_ADAPTER_IDS,
  normalizeWorkforceAdapterId,
  type WorkforceAdapterId,
  type WorkforceAgentAdapter,
  type WorkforceConnectionConfig,
} from "./workforce-types";

const DEFAULT_CREDENTIAL_REF: Record<WorkforceAdapterId, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gateway: "AGENT_GATEWAY_API_KEY",
  paradise: "PARADISEMODERN_API_KEY",
};

export function isWorkforceAdapterId(value: string): value is WorkforceAdapterId {
  return (WORKFORCE_ADAPTER_IDS as readonly string[]).includes(value);
}

/**
 * The key for a connection. `credentialRef` names any environment variable
 * the owner chose — two Anthropic connections can hold two different keys —
 * and falls back to the provider's conventional name. Reading process.env
 * directly is the point of the indirection: the ref is owner data, so it
 * cannot be a member of the typed env schema.
 */
function credential(ref: string): string | undefined {
  const value = process.env[ref]?.trim();
  if (value) return value;
  // The typed schema normalizes some known names; prefer its view when the
  // ref matches one it validates.
  const typed = env() as Record<string, unknown>;
  const fallback = typed[ref];
  return typeof fallback === "string" && fallback.trim() ? fallback.trim() : undefined;
}

function unavailable(adapter: string | null): WorkforceAgentAdapter {
  const message =
    adapter === null
      ? "This connection is inbound; there is no workforce adapter to run."
      : `No workforce adapter called "${adapter}" is installed in this build.`;
  return {
    id: "none",
    configured: false,
    credentialRef: null,
    defaultModel: null,
    turn() {
      return Promise.reject(new Error(message));
    },
  };
}

export const GATEWAY_OWN_CREDENTIAL =
  "a credential of its own (its base URL differs from AGENT_GATEWAY_URL, so AGENT_GATEWAY_API_KEY is not sent there)";

function comparableUrl(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * Whether a gateway connection's base URL is the instance-wide one (or is
 * absent, which means the instance-wide one).
 */
export function sharesInstanceGateway(baseUrl: string | null | undefined): boolean {
  if (!baseUrl) return true;
  const instance = env().AGENT_GATEWAY_URL;
  return Boolean(instance) && comparableUrl(baseUrl) === comparableUrl(instance ?? "");
}

export function workforceAdapter(
  connection: WorkforceConnectionConfig,
): WorkforceAgentAdapter {
  const id = normalizeWorkforceAdapterId(connection.adapter);
  if (!id || !isWorkforceAdapterId(id)) return unavailable(id);
  // The instance-wide gateway key belongs to the instance-wide gateway URL.
  // A connection pointing somewhere else must name its own credential, or
  // that key would be sent to a host it was never issued for.
  if (id === "gateway" && !connection.credentialRef && !sharesInstanceGateway(connection.baseUrl)) {
    return openAiCompatibleWorkforceAdapter({
      id,
      apiKey: undefined,
      credentialRef: null,
      baseUrl: connection.baseUrl,
      model: connection.model,
      missingCredential: GATEWAY_OWN_CREDENTIAL,
    });
  }
  const ref = connection.credentialRef ?? DEFAULT_CREDENTIAL_REF[id];
  const apiKey = credential(ref);
  if (id === "anthropic") {
    return anthropicWorkforceAdapter({
      apiKey,
      credentialRef: ref,
      baseUrl: connection.baseUrl,
      model: connection.model ?? ANTHROPIC_DEFAULT_MODEL,
    });
  }
  return openAiCompatibleWorkforceAdapter({
    id,
    apiKey,
    credentialRef: ref,
    // A neutral gateway connection without its own base URL uses the
    // instance-wide one the builder reads too.
    baseUrl: connection.baseUrl ?? (id === "gateway" ? (env().AGENT_GATEWAY_URL ?? null) : null),
    model: connection.model,
  });
}

export { WORKFORCE_ADAPTER_IDS, normalizeWorkforceAdapterId } from "./workforce-types";
export type {
  WorkforceAdapterId,
  WorkforceAgentAdapter,
  WorkforceConnectionConfig,
  WorkforceMessage,
  WorkforceToolCall,
  WorkforceTurnRequest,
  WorkforceTurnResult,
} from "./workforce-types";
