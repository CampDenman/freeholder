// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Every service declares an output schema (MASTER.md C3.01).
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineService, listServices, ServiceError, type Tx } from "@/core/service";
import { ready } from "@/core/runtime";
import { closeDb, hasDatabase } from "../helpers/spine";

describe("service output schemas (C3.01)", () => {
  it("refuses a handler return that does not match the declared schema", async () => {
    const service = defineService({
      name: "test.outputMismatch",
      summary: "Used only to prove output validation.",
      kind: "query",
      permission: "public",
      input: z.object({}),
      output: z.object({ ok: z.literal(true) }),
      handler: async () => ({ ok: false as unknown as true }),
    });
    const error = await service
      .call({}, { kind: "anonymous" }, { tx: {} as Tx })
      .then(
        () => {
          throw new Error("expected this call to fail, but it resolved");
        },
        (caught: unknown) => caught as ServiceError,
      );
    expect(error).toBeInstanceOf(ServiceError);
    expect(error.code).toBe("internal");
    expect(error.message).toContain("test.outputMismatch");
  });

  it.runIf(hasDatabase)(
    "declares an output schema on every registered service",
    async () => {
      await ready();
      const missing = [...listServices().values()]
        .filter((service) => !service.def.output)
        .map((service) => service.def.name)
        .sort();
      expect(missing, "add output schemas to these services").toEqual([]);
    },
    30_000,
  );
});

afterAll(closeDb);
