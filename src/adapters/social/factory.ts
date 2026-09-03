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
  SocialExternalReview,
  SocialIdentity,
  SocialInteraction,
  SocialOAuthTokens,
  SocialOwnedPost,
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
  ownedPostsUrl?: string;
  interactionUrl?: (postId: string) => string;
  reviewsUrl?: string;
  hoursUrl?: string;
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

function asList(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  const data = asRecord(body).data;
  return Array.isArray(data) ? data : [];
}

function parseOwnedPosts(body: unknown): SocialOwnedPost[] {
  const posts: SocialOwnedPost[] = [];
  for (const entry of asList(body)) {
    const row = asRecord(entry);
    const id = recordField(row, "id", "providerRef");
    if (!id) continue;
    const mediaUrl = recordField(row, "media_url", "mediaUrl", "url");
    const mime = recordField(row, "mime", "content_type") ?? "image/png";
    posts.push({
      providerRef: id,
      url: recordField(row, "permalink", "url"),
      body: recordField(row, "caption", "message", "text", "body") ?? "",
      publishedAt:
        recordField(row, "timestamp", "created_time", "publishedAt") ??
        new Date().toISOString(),
      media: mediaUrl
        ? [
            {
              url: mediaUrl,
              filename: recordField(row, "filename") ?? `${id}.png`,
              mime,
              altText: recordField(row, "alt_text", "altText") ?? undefined,
            },
          ]
        : [],
    });
  }
  return posts;
}

const STAR_NAMES: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

function parseRating(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.min(5, Math.max(1, Math.round(raw) || 1));
  }
  if (typeof raw === "string") {
    const named = STAR_NAMES[raw.toUpperCase()];
    if (named) return named;
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
      return Math.min(5, Math.max(1, Math.round(numeric) || 1));
    }
  }
  return 1;
}

function parseReviews(body: unknown): SocialExternalReview[] {
  const items: SocialExternalReview[] = [];
  for (const entry of asList(body)) {
    const row = asRecord(entry);
    const id = recordField(row, "id", "providerRef", "reviewId");
    if (!id) continue;
    const reviewer = nestedRecord(row, "reviewer");
    const email =
      recordField(row, "email") ?? recordField(reviewer, "email");
    items.push({
      providerRef: id,
      rating: parseRating(row.starRating ?? row.rating),
      body: recordField(row, "comment", "text", "body") ?? "",
      displayName:
        recordField(row, "displayName", "name") ??
        recordField(reviewer, "displayName", "name"),
      email: email && email.includes("@") ? email.toLowerCase() : null,
      occurredAt:
        recordField(row, "createTime", "timestamp", "occurredAt") ??
        new Date().toISOString(),
    });
  }
  return items;
}

function parseInteractions(
  body: unknown,
  postProviderRef: string,
): SocialInteraction[] {
  const items: SocialInteraction[] = [];
  for (const entry of asList(body)) {
    const row = asRecord(entry);
    const id = recordField(row, "id", "providerRef");
    const text = recordField(row, "text", "message", "body");
    if (!id || !text) continue;
    const email = recordField(row, "email", "author_email", "authorEmail");
    items.push({
      providerRef: id,
      postProviderRef:
        recordField(row, "post_id", "postProviderRef") ?? postProviderRef,
      kind: recordField(row, "kind") === "mention" ? "mention" : "comment",
      body: text,
      occurredAt:
        recordField(row, "timestamp", "created_time", "occurredAt") ??
        new Date().toISOString(),
      authorHandle:
        recordField(row, "username", "handle", "from") ?? "unknown",
      authorEmail: email && email.includes("@") ? email.toLowerCase() : null,
    });
  }
  return items;
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
    async listOwnedPosts(accessToken) {
      requireReady();
      const url = spec.ownedPostsUrl ?? `${spec.identityUrl.replace(/\/+$/, "")}/media`;
      const response = await socialFetch(spec.id, url, {
        method: "GET",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      return parseOwnedPosts(await socialJson(response, spec.id));
    },
    async listInteractions(accessToken, postProviderRef) {
      requireReady();
      const url =
        spec.interactionUrl?.(postProviderRef) ??
        `${spec.identityUrl.replace(/\/me\/?$/, "")}/${postProviderRef}/comments`;
      const response = await socialFetch(spec.id, url, {
        method: "GET",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      return parseInteractions(await socialJson(response, spec.id), postProviderRef);
    },
    async listReviews(accessToken) {
      requireReady();
      if (!spec.reviewsUrl) return [];
      const response = await socialFetch(spec.id, spec.reviewsUrl, {
        method: "GET",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      return parseReviews(await socialJson(response, spec.id));
    },
    async pushHours(accessToken, periods) {
      requireReady();
      if (!spec.hoursUrl) return;
      const response = await socialFetch(spec.id, spec.hoursUrl, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ periods }),
      });
      await socialJson(response, spec.id);
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
