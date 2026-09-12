// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Mail-read OAuth return must land in the inbox that started it (C11.09 F04).
import { beforeEach, describe, expect, it, vi } from "vitest";

const callbackMocks = vi.hoisted(() => ({
  actor: vi.fn(async (_request: Request) => ({
    kind: "user" as const,
    userId: "00000000-0000-4000-8000-000000000001",
    role: "owner",
    grants: [{ module: "*", access: "manage" as const }],
  })),
  complete: vi.fn(async (_input: unknown, _actor: unknown) => ({
    connectedAccountId: "00000000-0000-4000-8000-000000000010",
    email: "owner@example.test",
    scopes: ["mail.readonly"],
    returnTo: "/admin/inbox",
  })),
  peek: vi.fn(async (_input: unknown, _actor: unknown) => ({
    returnTo: "/admin/inbox",
  })),
}));

vi.mock("@/core/http/actor", () => ({
  actorFromRequest: callbackMocks.actor,
}));

vi.mock("@/core/connections/mail-read-oauth", () => ({
  completeMailReadOAuth: { call: callbackMocks.complete },
  peekMailReadOAuthReturn: { call: callbackMocks.peek },
}));

vi.mock("@/core/env", () => ({
  env: () => ({ APP_URL: "https://freeholder.example" }),
}));

import { ServiceError } from "@/core/service";
import { GET } from "../../app/api/connections/mail-read/[provider]/callback/route";

function callback(
  provider = "google",
  query = "?state=state-value-long-enough-for-provider&code=provider-code",
): Promise<Response> {
  return GET(
    new Request(
      `https://freeholder.example/api/connections/mail-read/${provider}/callback${query}`,
    ),
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
    connectedAccountId: "00000000-0000-4000-8000-000000000010",
    email: "owner@example.test",
    scopes: ["mail.readonly"],
    returnTo: "/admin/inbox",
  });
  callbackMocks.peek.mockReset();
  callbackMocks.peek.mockResolvedValue({ returnTo: "/admin/inbox" });
});

describe("the mail-read OAuth callback", () => {
  it("rejects unknown providers onto the inbox", async () => {
    const response = await callback("imap");
    expect(location(response).pathname).toBe("/admin/inbox");
    expect(location(response).searchParams.get("mailbox")).toBe(
      "oauth_invalid_provider",
    );
  });

  it("honours the stored returnTo on cancel", async () => {
    callbackMocks.peek.mockResolvedValue({ returnTo: "/admin/inbox?view=unread" });
    const cancelled = await callback(
      "microsoft",
      "?error=access_denied&error_description=provider-secret-detail&state=secret-state-that-is-long-enough",
    );
    expect(location(cancelled).pathname).toBe("/admin/inbox");
    expect(location(cancelled).searchParams.get("view")).toBe("unread");
    expect(location(cancelled).searchParams.get("mailbox")).toBe("oauth_cancelled");
    expect(location(cancelled).toString()).not.toContain("provider-secret-detail");
  });

  it("returns mailbox=connected on the stored admin path", async () => {
    const response = await callback();
    expect(location(response).pathname).toBe("/admin/inbox");
    expect(location(response).searchParams.get("mailbox")).toBe("connected");
  });

  it("maps service failures onto the inbox without exposing provider detail", async () => {
    callbackMocks.complete.mockRejectedValueOnce(
      new ServiceError("conflict", "private account collision"),
    );
    const response = await callback();
    expect(location(response).pathname).toBe("/admin/inbox");
    expect(location(response).searchParams.get("mailbox")).toBe("oauth_conflict");
    expect(location(response).toString()).not.toContain("private");
  });
});
