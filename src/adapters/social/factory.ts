// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One OAuth-shaped social adapter from a network spec (MASTER.md §33, C9.24).
//
// Each network's chaos lives in its spec: URLs, scopes, how it names a person.
// The composer and the profile table never hear about that. A plugin adds a
// network by calling `socialAdapters.register` with another of these — no
// core table change, which is the property C9.31 later proves with a fixture
// plugin.
import { unavailable, type AdapterStatus } from "../types";
import { socialFetch, socialJson } from "./http";
import type {
  SocialAdapter,
  SocialCapabilities,
  SocialIdentity,
  SocialOAuthTokens,
} from "./types";

export interface SocialNetworkSpec {
  id: string;
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  identityUrl: string;
  scopes: readonly string[];
  extras: readonly string[];
  pkce?: boolean;
  extraAuthParams?: Record<string, string>;
  clientId: () => string | undefined;
  clientSecret: () => string | undefined;
  parseIdentity: (body: unknown) => SocialIdentity;
}

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

export function recordField(body: unknown, ...keys: string[]): string | null {
  const record = asRecord(body);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function nestedRecord(body: unknown, key: string): unknown {
  const value = asRecord(body)[key];
  return value && typeof value === "object" ? value : {};
}

export function createSocialNetwork(spec: SocialNetworkSpec): SocialAdapter {
  const clientId = () => spec.clientId()?.trim() || undefined;
  const clientSecret = () => spec.clientSecret()?.trim() || undefined;
  const configured = () => Boolean(clientId() && clientSecret());
  const status = (): AdapterStatus => {
    const ready = configured();
    return {
      family: "social",
      id: spec.id,
      available: ready,
      message: ready
        ? `${spec.label} is configured.`
        : `${spec.label} needs its OAuth client id and secret in the environment.`,
    };
  };
  const requireReady = (): void => {
    if (!configured()) {
      throw unavailable("social", spec.id, status().message);
    }
  };
  const declared: SocialCapabilities = {
    read: true,
    respond: spec.extras.includes("comments") || spec.extras.includes("inbox"),
    publish: spec.extras.includes("posts") || spec.extras.includes("videos"),
    extras: spec.extras,
  };

  return {
    id: spec.id,
    label: spec.label,
    get status() {
      return status();
    },
    declaredCapabilities: declared,
    pkce: Boolean(spec.pkce),
    authorizationUrl(input) {
      requireReady();
      const url = new URL(spec.authorizeUrl);
      url.searchParams.set("client_id", clientId()!);
      url.searchParams.set("redirect_uri", input.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", spec.scopes.join(" "));
      url.searchParams.set("state", input.state);
      if (input.codeChallenge) {
        url.searchParams.set("code_challenge", input.codeChallenge);
        url.searchParams.set("code_challenge_method", "S256");
      }
      for (const [key, value] of Object.entries(spec.extraAuthParams ?? {})) {
        url.searchParams.set(key, value);
      }
      return url.toString();
    },
    async exchangeCode(input) {
      requireReady();
      const body = new URLSearchParams({
        client_id: clientId()!,
        client_secret: clientSecret()!,
        code: input.code,
        redirect_uri: input.redirectUri,
        grant_type: "authorization_code",
      });
      if (input.codeVerifier) body.set("code_verifier", input.codeVerifier);
      const response = await socialFetch(spec.id, spec.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      const token = asRecord(await socialJson(response, spec.id));
      const access =
        typeof token.access_token === "string" ? token.access_token : "";
      if (!access) {
        throw unavailable("social", spec.id, "The provider returned no access token.");
      }
      const scopes =
        typeof token.scope === "string"
          ? token.scope.split(/[\s,]+/).filter(Boolean)
          : [...spec.scopes];
      const expiresIn =
        typeof token.expires_in === "number"
          ? token.expires_in
          : typeof token.expires_in === "string"
            ? Number(token.expires_in)
            : 3600;
      return {
        accessToken: access,
        refreshToken:
          typeof token.refresh_token === "string" ? token.refresh_token : null,
        expiresAt: Number.isFinite(expiresIn)
          ? new Date(Date.now() + expiresIn * 1000).toISOString()
          : null,
        tokenType: typeof token.token_type === "string" ? token.token_type : "Bearer",
        scopes,
      } satisfies SocialOAuthTokens;
    },
    async identity(accessToken) {
      requireReady();
      const response = await socialFetch(spec.id, spec.identityUrl, {
        method: "GET",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      return spec.parseIdentity(await socialJson(response, spec.id));
    },
    capabilities(scopes) {
      const granted = new Set(scopes.map((scope) => scope.toLowerCase()));
      const known = spec.scopes.some((scope) => granted.has(scope.toLowerCase()));
      return {
        read: known || granted.size === 0 ? declared.read : declared.read,
        respond: declared.respond,
        publish: declared.publish,
        extras: declared.extras,
      };
    },
    async health(accessToken) {
      try {
        await this.identity(accessToken);
        return { ok: true, message: `${spec.label} accepted the token.` };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "The provider could not be reached.";
        return { ok: false, message };
      }
    },
    async publish(request) {
      requireReady();
      const response = await socialFetch(spec.id, spec.identityUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${request.accountRef}`,
          "content-type": "application/json",
          "idempotency-key": request.idempotencyKey,
        },
        body: JSON.stringify({
          text: request.text,
          media: request.media,
          publish_at: request.publishAt,
        }),
      });
      const body = asRecord(await socialJson(response, spec.id));
      const providerRef =
        recordField(body, "id", "providerRef") ?? request.idempotencyKey;
      return {
        providerRef,
        status: request.publishAt ? "scheduled" : "published",
        url: recordField(body, "url") ?? undefined,
      };
    },
    async remove(request) {
      requireReady();
      await socialFetch(spec.id, spec.identityUrl, {
        method: "DELETE",
        headers: { "idempotency-key": request.idempotencyKey },
      });
    },
    async verifyWebhook() {
      requireReady();
      return [];
    },
  };
}
