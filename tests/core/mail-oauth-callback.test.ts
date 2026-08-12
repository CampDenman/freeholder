// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The delegated-mail OAuth return is a security boundary, not a provider test.
import { beforeEach, describe, expect, it, vi } from "vitest";

const callbackMocks = vi.hoisted(() => ({
  actor: vi.fn(async (_request: Request) => ({
    kind: "user" as const,
    userId: "00000000-0000-4000-8000-000000000001",
    role: "owner",
    grants: [{ module: "*", access: "manage" as const }],
  })),
  complete: vi.fn(async (_input: unknown, _actor: unknown) => ({
    senderId: "00000000-0000-4000-8000-000000000010",
    email: "owner@example.test",
    returnTo: "/admin/settings?tab=mail",
  })),
}));

vi.mock("@/core/http/actor", () => ({
  actorFromRequest: callbackMocks.actor,
}));

vi.mock("@/core/mail/oauth", () => ({
  completeMailOAuth: { call: callbackMocks.complete },
}));

vi.mock("@/core/env", () => ({
  env: () => ({ APP_URL: "https://freeholder.example" }),
}));

import { ServiceError } from "@/core/service";
import { GET } from "../../app/api/mail/oauth/[provider]/callback/route";

function callback(
  provider = "google",
  query = "?state=state-value-long-enough-for-provider&code=provider-code",
): Promise<Response> {
  return GET(
    new Request(`https://freeholder.example/api/mail/oauth/${provider}/callback${query}`),
    { params: Promise.resolve({ provider }) },
  );
}

function location(response: Response): URL {
  return new URL(response.headers.get("location")!);
}

beforeEach(() => {
  callbackMocks.actor.mockReset();
  callbackMocks.actor.mockResolvedValue({
    kind: "user",
    userId: "00000000-0000-4000-8000-000000000001",
    role: "owner",
    grants: [{ module: "*", access: "manage" }],
  });
  callbackMocks.complete.mockReset();
  callbackMocks.complete.mockResolvedValue({
    senderId: "00000000-0000-4000-8000-000000000010",
    email: "owner@example.test",
    returnTo: "/admin/settings?tab=mail",
  });
});

describe("the mail OAuth callback", () => {
  it("rejects unknown providers before resolving a session", async () => {
    const response = await callback("imap");
    expect(response.status).toBe(303);
    expect(location(response).pathname).toBe("/admin/settings");
    expect(location(response).searchParams.get("mail")).toBe(
      "oauth_invalid_provider",
    );
    expect(callbackMocks.actor).not.toHaveBeenCalled();
  });

  it("requires a signed-in person and never puts OAuth values in a redirect", async () => {
    callbackMocks.actor.mockResolvedValueOnce({ kind: "anonymous" } as never);
    const response = await callback(
      "google",
      "?state=secret-state-that-must-not-leak&code=secret-code-that-must-not-leak",
    );
    expect(location(response).toString()).toBe(
      "https://freeholder.example/login?returnTo=%2Fadmin%2Fsettings",
    );
    expect(location(response).toString()).not.toContain("secret-");
    expect(callbackMocks.complete).not.toHaveBeenCalled();
  });

  it("maps cancellation and incomplete returns to fixed safe reasons", async () => {
    const cancelled = await callback(
      "microsoft",
      "?error=access_denied&error_description=provider-secret-detail&state=secret-state",
    );
    expect(location(cancelled).searchParams.get("mail")).toBe("oauth_cancelled");
    expect(location(cancelled).toString()).not.toContain("provider-secret-detail");

    const incomplete = await callback("google", "?state=only-state");
    expect(location(incomplete).searchParams.get("mail")).toBe("oauth_incomplete");
  });

  it("returns only to the stored admin path and applies privacy headers", async () => {
    const response = await callback();
    const target = location(response);
    expect(target.origin).toBe("https://freeholder.example");
    expect(target.pathname).toBe("/admin/settings");
    expect(target.searchParams.get("tab")).toBe("mail");
    expect(target.searchParams.get("mail")).toBe("connected");
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(callbackMocks.complete).toHaveBeenCalledWith(
      {
        provider: "google",
        state: "state-value-long-enough-for-provider",
        code: "provider-code",
      },
      expect.objectContaining({ kind: "user" }),
    );
  });

  it("defensively refuses a non-admin stored return path", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    callbackMocks.complete.mockResolvedValueOnce({
      senderId: "00000000-0000-4000-8000-000000000010",
      email: "owner@example.test",
      returnTo: "https://attacker.example/collect",
    });
    const response = await callback();
    expect(location(response).toString()).toBe(
      "https://freeholder.example/admin/settings?mail=oauth_failed",
    );
    log.mockRestore();
  });

  it("maps service failures without exposing provider detail", async () => {
    for (const [error, reason] of [
      [new ServiceError("conflict", "private account collision"), "oauth_conflict"],
      [new ServiceError("permission", "private expired state"), "oauth_expired"],
      [new ServiceError("validation", "private provider response"), "oauth_failed"],
    ] as const) {
      callbackMocks.complete.mockRejectedValueOnce(error);
      const response = await callback();
      expect(location(response).searchParams.get("mail")).toBe(reason);
      expect(location(response).toString()).not.toContain("private");
    }
  });

  it("turns actor-resolution and unexpected failures into a fixed redirect", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    callbackMocks.actor.mockRejectedValueOnce(new Error("database detail"));
    const actorFailure = await callback();
    expect(location(actorFailure).searchParams.get("mail")).toBe("oauth_failed");

    callbackMocks.complete.mockRejectedValueOnce(new Error("provider response detail"));
    const providerFailure = await callback();
    expect(location(providerFailure).searchParams.get("mail")).toBe("oauth_failed");
    expect(location(providerFailure).toString()).not.toContain("provider");
    log.mockRestore();
  });
});
