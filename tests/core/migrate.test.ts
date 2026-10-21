// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const events: string[] = [];
  const client = Object.assign(
    vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      events.push(`lock:${values.join(":")}`);
      return [];
    }),
    {
      end: vi.fn(async () => {
        events.push("end");
      }),
    },
  );
  return {
    client,
    drizzle: vi.fn(() => "drizzle-client"),
    events,
    migrate: vi.fn(async () => {
      events.push("migrate");
    }),
    postgres: vi.fn(
      (_url: string, _options: { max: number; onnotice: () => void }) => client,
    ),
  };
});

vi.mock("postgres", () => ({ default: mocks.postgres }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: mocks.drizzle }));
vi.mock("drizzle-orm/postgres-js/migrator", () => ({ migrate: mocks.migrate }));
vi.mock("@/core/env", () => ({
  env: () => ({ DATABASE_URL: "postgres://freeholder:test@localhost/freeholder_test" }),
}));

import { migrateToLatest } from "@/core/migrate";

describe("boot migration serialization", () => {
  beforeEach(() => {
    delete process.env.FREEHOLDER_SKIP_MIGRATE;
    mocks.events.length = 0;
    vi.clearAllMocks();
  });

  it("holds a dedicated PostgreSQL session lock around migrations", async () => {
    await expect(migrateToLatest()).resolves.toEqual({ ran: true });

    expect(mocks.events).toEqual([
      `lock:${0x46726565}:${0x686f6c64}`,
      "migrate",
      "end",
    ]);
    expect(mocks.postgres).toHaveBeenCalledOnce();
    const postgresOptions = mocks.postgres.mock.calls[0]?.[1];
    expect(postgresOptions?.max).toBe(1);
    expect(typeof postgresOptions?.onnotice).toBe("function");
    expect(mocks.drizzle).toHaveBeenCalledWith(mocks.client);
    expect(mocks.migrate).toHaveBeenCalledWith("drizzle-client", {
      migrationsFolder: "db/migrations",
    });
  });

  it("closes the locking session when migration fails", async () => {
    const failure = new Error("migration failed");
    mocks.migrate.mockRejectedValueOnce(failure);

    await expect(migrateToLatest()).rejects.toBe(failure);
    expect(mocks.events).toEqual([
      `lock:${0x46726565}:${0x686f6c64}`,
      "end",
    ]);
  });
});
