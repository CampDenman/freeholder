// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Rate limiting (MASTER.md §36). The properties worth proving are the ones a
// limiter usually gets wrong: that *failed* attempts are counted (the whole
// point, and the one a transaction-scoped counter silently loses), that the
// budget is per subject, and that success clears it.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/core/db";
import { login, registerOwner } from "@/core/auth/service";
import { consume, rateLimitKey, reset } from "@/core/security/rate-limit";
import { ServiceError } from "@/core/service";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  truncateSpine,
} from "../helpers/spine";

const OWNER_PASSWORD = "a-sufficiently-long-owner-password";

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
