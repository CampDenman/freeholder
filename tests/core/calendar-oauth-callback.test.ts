// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Calendar OAuth return must land on the screen that started it (C11.09 F04).
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
    access: "read" as const,
    scopes: ["calendar.readonly"],
    returnTo: "/admin/calendar",
  })),
  peek: vi.fn(async (_input: unknown, _actor: unknown) => ({
    returnTo: "/admin/calendar",
  })),
}));

vi.mock("@/core/http/actor", () => ({
  actorFromRequest: callbackMocks.actor,
}));

vi.mock("@/core/connections/calendar-oauth", () => ({
  completeCalendarOAuth: { call: callbackMocks.complete },
  peekCalendarOAuthReturn: { call: callbackMocks.peek },
}));

vi.mock("@/core/env", () => ({
  env: () => ({ APP_URL: "https://freeholder.example" }),
}));

import { ServiceError } from "@/core/service";
import { GET } from "../../app/api/connections/calendar/[provider]/callback/route";

function callback(
  provider = "google",
  query = "?state=state-value-long-enough-for-provider&code=provider-code",
): Promise<Response> {
  return GET(
    new Request(
      `https://freeholder.example/api/connections/calendar/${provider}/callback${query}`,
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
    access: "read",
    scopes: ["calendar.readonly"],
    returnTo: "/admin/calendar",
  });
  callbackMocks.peek.mockReset();
  callbackMocks.peek.mockResolvedValue({ returnTo: "/admin/calendar" });
});

describe("the calendar OAuth callback", () => {
  it("rejects unknown providers onto the calendar screen", async () => {
    const response = await callback("imap");
    expect(response.status).toBe(303);
    expect(location(response).pathname).toBe("/admin/calendar");
    expect(location(response).searchParams.get("calendar")).toBe(
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
      "https://freeholder.example/login?returnTo=%2Fadmin%2Fcalendar",
    );
    expect(location(response).toString()).not.toContain("secret-");
    expect(callbackMocks.complete).not.toHaveBeenCalled();
  });

  it("honours the stored returnTo on cancel and incomplete returns", async () => {
    callbackMocks.peek.mockResolvedValue({ returnTo: "/admin/calendar?week=2026-09-14" });
    const cancelled = await callback(
      "microsoft",
      "?error=access_denied&error_description=provider-secret-detail&state=secret-state-that-is-long-enough",
    );
    expect(location(cancelled).pathname).toBe("/admin/calendar");
    expect(location(cancelled).searchParams.get("week")).toBe("2026-09-14");
    expect(location(cancelled).searchParams.get("calendar")).toBe("oauth_cancelled");
    expect(location(cancelled).toString()).not.toContain("provider-secret-detail");

    const incomplete = await callback("google", "?state=only-state-but-still-long-enough-xx");
    expect(location(incomplete).searchParams.get("calendar")).toBe("oauth_incomplete");
  });

  it("returns only to the stored admin path and applies privacy headers", async () => {
    const response = await callback();
    const target = location(response);
    expect(target.origin).toBe("https://freeholder.example");
    expect(target.pathname).toBe("/admin/calendar");
    expect(target.searchParams.get("calendar")).toBe("connected");
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("defensively refuses a non-admin stored return path", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    callbackMocks.complete.mockResolvedValueOnce({
      connectedAccountId: "00000000-0000-4000-8000-000000000010",
      email: "owner@example.test",
      access: "read",
      scopes: ["calendar.readonly"],
      returnTo: "https://attacker.example/collect",
    });
    const response = await callback();
    expect(location(response).pathname).toBe("/admin/calendar");
    expect(location(response).searchParams.get("calendar")).toBe("oauth_failed");
    log.mockRestore();
  });

  it("maps service failures onto the stored return without exposing provider detail", async () => {
    for (const [error, reason] of [
      [new ServiceError("conflict", "private account collision"), "oauth_conflict"],
      [new ServiceError("permission", "private expired state"), "oauth_denied"],
      [new ServiceError("validation", "private provider response"), "oauth_failed"],
    ] as const) {
      callbackMocks.complete.mockRejectedValueOnce(error);
      const response = await callback();
      expect(location(response).pathname).toBe("/admin/calendar");
      expect(location(response).searchParams.get("calendar")).toBe(reason);
      expect(location(response).toString()).not.toContain("private");
    }
  });
});
