// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Actor labels for C2.02 author history.

import { describe, expect, it } from "vitest";
import { authorRef, parseActor } from "@/modules/cms/history";

describe("cms author history labels", () => {
  it("resolves a user actor to their email when known", () => {
    const actor = "user:00000000-0000-4000-8000-000000000001";
    expect(parseActor(actor)).toEqual({
      kind: "user",
      id: "00000000-0000-4000-8000-000000000001",
    });
    expect(
      authorRef(actor, new Map([["00000000-0000-4000-8000-000000000001", "owner@example.test"]]))
        .label,
    ).toBe("owner@example.test");
  });

  it("keeps the stored actor string when the user row is gone", () => {
    const actor = "user:00000000-0000-4000-8000-000000000099";
    expect(authorRef(actor, new Map()).label).toBe(actor);
  });

  it("names agents, system and anonymous without a lookup", () => {
    expect(authorRef("agent:Inbox triager", new Map())).toMatchObject({
      kind: "agent",
      label: "Inbox triager",
    });
    expect(parseActor("system")).toEqual({ kind: "system", id: null });
    expect(parseActor("anonymous")).toEqual({ kind: "anonymous", id: null });
  });
});
