// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Rate limiting (MASTER.md §36). The properties worth proving are the ones a
// limiter usually gets wrong: that *failed* attempts are counted (the whole
// point, and the one a transaction-scoped counter silently loses), that the
// budget is per subject, and that success clears it.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/core/db";
import { login, registerOwner } from "@/core/auth/service";
import { anonymousClientKey, clientNetwork, consume, rateLimitKey, reset } from "@/core/security/rate-limit";
import { defineService, ServiceError } from "@/core/service";
import { z } from "zod";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  truncateSpine,
} from "../helpers/spine";

const OWNER_PASSWORD = "a-sufficiently-long-owner-password";

describe("the client a rate limit counts (C11.10)", () => {
  it("is the /64 for IPv6, however the address is written", () => {
    expect(clientNetwork("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(clientNetwork("2001:0DB8:0001:0002:ffff:0:0:9")).toBe("2001:db8:1:2::/64");
    expect(clientNetwork("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(clientNetwork("::1")).toBe("0:0:0:0::/64");
    expect(clientNetwork("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });

  it("is the IPv4 address an IPv4-mapped IPv6 address carries", () => {
    expect(clientNetwork("::ffff:203.0.113.5")).toBe("203.0.113.5");
    expect(clientNetwork("::FFFF:cb00:7105")).toBe("203.0.113.5");
    expect(anonymousClientKey({ kind: "anonymous", request: { ip: "::ffff:203.0.113.5" } })).toBe(
      "untrusted-ip:203.0.113.5",
    );
    expect(
      anonymousClientKey({
        kind: "anonymous",
        request: { ip: "203.0.113.1", trustedIp: "::ffff:192.0.2.7" },
      }),
    ).toBe("ip:192.0.2.7");
  });

  it("leaves IPv4 and anything unparseable as it is", () => {
    expect(clientNetwork("192.0.2.1")).toBe("192.0.2.1");
    expect(clientNetwork("unknown")).toBe("unknown");
  });
});

describe.runIf(hasDatabase)("rate limiting", () => {
  beforeEach(async () => {
    await truncateSpine();
  });

  afterAll(async () => {
    await closeDb();
  });

  describe("the counter", () => {
    it("allows up to the limit and refuses past it", async () => {
      const policy = { limit: 3, windowSeconds: 60 };
      const key = rateLimitKey("test.thing", "subject-a");

      const verdicts = [];
      for (let i = 0; i < 4; i += 1) {
        verdicts.push(await consume(key, policy));
      }

      expect(verdicts.map((v) => v.allowed)).toEqual([
        true,
        true,
        true,
        false,
      ]);
      expect(verdicts[3]!.attempts).toBe(4);
      expect(verdicts[3]!.retryAfterSeconds).toBeGreaterThan(0);
      expect(verdicts[3]!.retryAfterSeconds).toBeLessThanOrEqual(60);
    });

    it("counts each subject separately", async () => {
      const policy = { limit: 1, windowSeconds: 60 };
      await consume(rateLimitKey("test.thing", "subject-a"), policy);

      const other = await consume(
        rateLimitKey("test.thing", "subject-b"),
        policy,
      );
      expect(other.allowed).toBe(true);
    });

    it("gives two services separate budgets for the same subject", async () => {
      const policy = { limit: 1, windowSeconds: 60 };
      await consume(rateLimitKey("auth.login", "sam@example.test"), policy);

      // Failing to sign in must not consume the allowance for asking for a
      // password reset — otherwise the lockout has no exit.
      const elsewhere = await consume(
        rateLimitKey("auth.requestReset", "sam@example.test"),
        policy,
      );
      expect(elsewhere.allowed).toBe(true);
    });

    it("normalizes the subject so casing cannot buy extra attempts", async () => {
      const policy = { limit: 1, windowSeconds: 60 };
      await consume(rateLimitKey("auth.login", "Sam@Example.test"), policy);

      const shouted = await consume(
        rateLimitKey("auth.login", "SAM@EXAMPLE.TEST"),
        policy,
      );
      expect(shouted.allowed).toBe(false);
    });

    it("starts a fresh window once the old one has passed", async () => {
      const policy = { limit: 1, windowSeconds: 60 };
      const key = rateLimitKey("test.thing", "subject-c");
      await consume(key, policy);
      expect((await consume(key, policy)).allowed).toBe(false);

      // Age the window rather than waiting a minute for it.
      await db().execute(
        sql`update rate_limit_counters set window_started_at = now() - interval '2 minutes' where key = ${key}`,
      );

      const afterWindow = await consume(key, policy);
      expect(afterWindow.allowed).toBe(true);
      expect(afterWindow.attempts).toBe(1);
    });

    it("forgets a subject on reset", async () => {
      const policy = { limit: 1, windowSeconds: 60 };
      const key = rateLimitKey("test.thing", "subject-d");
      await consume(key, policy);
      expect((await consume(key, policy)).allowed).toBe(false);

      await reset(key);
      expect((await consume(key, policy)).allowed).toBe(true);
    });
  });

  // C11.10: without TRUSTED_CLIENT_IP_HEADER the per-visitor key is the
  // forwarded address. It must never become one shared bucket (a site-wide
  // off switch), and the forgeable remainder is bounded by a backstop.
  describe("anonymous callers without a validated address", () => {
    const probe = defineService({
      name: "test.untrustedProbe",
      summary: "Rate-limit probe.",
      kind: "query",
      permission: "public",
      input: z.object({}),
      output: z.object({ ok: z.literal(true) }),
      rateLimit: {
        limit: 2,
        windowSeconds: 60,
        subject: (_input, actor) => anonymousClientKey(actor),
        untrustedBackstop: { limit: 5, windowSeconds: 60 },
        message: "Slow down.",
      },
      handler: async () => ({ ok: true as const }),
    });
    const from = (ip: string, trustedIp?: string) => ({
      kind: "anonymous" as const,
      request: { ip, ...(trustedIp ? { trustedIp } : {}) },
    });

    it("keys each forwarded address separately, so one visitor cannot lock out the rest", async () => {
      await probe.call({}, from("203.0.113.1"));
      await probe.call({}, from("203.0.113.1"));
      expect((await failure(probe.call({}, from("203.0.113.1")))).code).toBe("rate_limited");
      await expect(probe.call({}, from("203.0.113.2"))).resolves.toEqual({ ok: true });
    });

    it("bounds forged addresses with the site-wide backstop", async () => {
      for (let index = 0; index < 5; index += 1) {
        await probe.call({}, from(`198.51.100.${index}`));
      }
      expect((await failure(probe.call({}, from("198.51.100.99")))).code).toBe("rate_limited");
      // A validated address is not counted against the untrusted ceiling.
      await expect(probe.call({}, from("198.51.100.99", "192.0.2.7"))).resolves.toEqual({ ok: true });
    });

    it("does not let one client over its own limit spend the shared ceiling", async () => {
      // Two allowed, eight refused by the client's own bucket.
      for (let index = 0; index < 10; index += 1) {
        await probe.call({}, from("203.0.113.77")).catch(() => undefined);
      }
      // Only the two accepted calls reached the backstop (limit 5), so three
      // other visitors still get through.
      for (const ip of ["192.0.2.11", "192.0.2.12", "192.0.2.13"]) {
        await expect(probe.call({}, from(ip))).resolves.toEqual({ ok: true });
      }
    });

    it("prefers the validated address when the deployment provides one", () => {
      expect(anonymousClientKey(from("203.0.113.1", "192.0.2.7"))).toBe("ip:192.0.2.7");
      expect(anonymousClientKey(from("203.0.113.1"))).toBe("untrusted-ip:203.0.113.1");
    });

    it("still bounds validated callers, with a higher ceiling of their own", async () => {
      // Default: ten times the untrusted ceiling (5), counted separately.
      for (let index = 0; index < 50; index += 1) {
        await probe.call({}, from("203.0.113.200", `192.0.2.${index + 1}`));
      }
      expect(
        (await failure(probe.call({}, from("203.0.113.200", "192.0.2.99")))).code,
      ).toBe("rate_limited");
      // The untrusted bucket was not spent by any of that.
      await expect(probe.call({}, from("198.51.100.1"))).resolves.toEqual({ ok: true });
    });

    it("counts a validated caller against its own limit before the shared ceiling", async () => {
      const tight = defineService({
        name: "test.trustedCeiling",
        summary: "Rate-limit probe.",
        kind: "query",
        permission: "public",
        input: z.object({}),
        output: z.object({ ok: z.literal(true) }),
        rateLimit: {
          limit: 2,
          windowSeconds: 60,
          subject: (_input, actor) => anonymousClientKey(actor),
          untrustedBackstop: { limit: 1, windowSeconds: 60 },
          trustedBackstop: { limit: 3, windowSeconds: 60 },
          message: "Slow down.",
        },
        handler: async () => ({ ok: true as const }),
      });
      // One client over its own limit spends two of the three.
      for (let index = 0; index < 6; index += 1) {
        await tight.call({}, from("203.0.113.9", "192.0.2.50")).catch(() => undefined);
      }
      await expect(tight.call({}, from("203.0.113.9", "192.0.2.51"))).resolves.toEqual({ ok: true });
      expect((await failure(tight.call({}, from("203.0.113.9", "192.0.2.52")))).code).toBe(
        "rate_limited",
      );
    });

    it("counts an IPv6 /64 as one client, trusted or not", async () => {
      await probe.call({}, from("198.51.100.5", "2001:db8:1:2::1"));
      await probe.call({}, from("198.51.100.5", "2001:db8:1:2:ffff:ffff:ffff:9"));
      expect(
        (await failure(probe.call({}, from("198.51.100.5", "2001:db8:1:2::abcd")))).code,
      ).toBe("rate_limited");
      await expect(probe.call({}, from("198.51.100.5", "2001:db8:1:3::1"))).resolves.toEqual({
        ok: true,
      });

      await probe.call({}, from("2001:db8:9:9::1"));
      await probe.call({}, from("2001:db8:9:9::2"));
      expect((await failure(probe.call({}, from("2001:db8:9:9::3")))).code).toBe("rate_limited");
    });
  });

  describe("auth.login", () => {
    beforeEach(async () => {
      await registerOwner.call(
        { email: "owner@example.test", password: OWNER_PASSWORD },
        ANONYMOUS,
      );
    });

    /**
     * The regression this whole design exists for. A failed login throws, so a
     * counter incremented inside the service transaction rolls back with it and
     * never records anything — the limiter would pass every test that only
     * exercises correct passwords and stop nothing in production.
     */
    it("counts failed attempts, which roll their transaction back", async () => {
      const wrong = () =>
        login.call(
          { email: "owner@example.test", password: "not-the-password" },
          ANONYMOUS,
        );

      for (let i = 0; i < 10; i += 1) {
        const error = await failure(wrong());
        expect(error.code).toBe("permission");
      }

      const throttled = await failure(wrong());
      expect(throttled.code).toBe("rate_limited");
      expect(throttled.retryAfterSeconds).toBeGreaterThan(0);
      expect(throttled.message).toMatch(/too many sign-in attempts/i);
    });

    it("throttles by email even when the account does not exist", async () => {
      // No user-enumeration oracle: an unknown address must be throttled the
      // same way, or the limiter itself becomes the oracle.
      const guess = () =>
        login.call(
          { email: "ghost@example.test", password: "guessing" },
          ANONYMOUS,
        );

      for (let i = 0; i < 10; i += 1) {
        expect((await failure(guess())).code).toBe("permission");
      }
      expect((await failure(guess())).code).toBe("rate_limited");
    });

    it("does not spend one account's budget on another", async () => {
      for (let i = 0; i < 11; i += 1) {
        await failure(
          login.call(
            { email: "owner@example.test", password: "wrong" },
            ANONYMOUS,
          ),
        );
      }

      const other = await failure(
        login.call(
          { email: "someone-else@example.test", password: "wrong" },
          ANONYMOUS,
        ),
      );
      expect(other.code).toBe("permission");
    });

    it("clears the budget when the password is finally right", async () => {
      for (let i = 0; i < 9; i += 1) {
        await failure(
          login.call(
            { email: "owner@example.test", password: "wrong" },
            ANONYMOUS,
          ),
        );
      }

      const session = await login.call(
        { email: "owner@example.test", password: OWNER_PASSWORD },
        ANONYMOUS,
      );
      expect(session.token).toBeTruthy();

      // Nine fumbles then success must not leave the owner one mistake from a
      // lockout for the rest of the window.
      const afterSuccess = await failure(
        login.call(
          { email: "owner@example.test", password: "wrong" },
          ANONYMOUS,
        ),
      );
      expect(afterSuccess.code).toBe("permission");
    });

    it("answers 429 with Retry-After at the HTTP edge", async () => {
      const error = new ServiceError("rate_limited", "Too many.", 42);
      const { errorResponse } = await import("@/core/http/respond");
      const response = errorResponse(error, ANONYMOUS);
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("42");
    });
  });
});
