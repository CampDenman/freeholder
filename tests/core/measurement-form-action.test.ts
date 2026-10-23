// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.32: how the public form action hands a saved enquiry to the measurement
// provider. The conversion runs after the response, and nothing about it —
// not even a failure to plan it — can turn a saved enquiry into an error.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Plan = (input: unknown) => Promise<(() => Promise<void>) | null>;
const state = vi.hoisted(() => {
  const plan: Plan = () => Promise.resolve(null);
  return { after: [] as Array<() => Promise<void>>, plan, planned: [] as unknown[] };
});

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (name: string) => (name === "x-freeholder-path" ? "/contact" : null) }),
  cookies: async () => ({
    get: (name: string) => (name === "fh_ac" ? { value: "granted" } : undefined),
    set: () => undefined,
    delete: () => undefined,
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));
vi.mock("next/server", () => ({ after: (task: () => Promise<void>) => state.after.push(task) }));
vi.mock("@/modules/forms/service", () => ({
  submitForm: { call: async () => ({ ok: true, submissionId: "00000000-0000-4000-8000-000000000009", message: "ok" }) },
}));
vi.mock("@/core/settings/read", () => ({ currentBusiness: async () => null }));
vi.mock("../../app/i18n", () => ({ getLocale: async () => "en" }));
vi.mock("@/modules/analytics/measurement", () => ({
  leadConversionTask: (input: unknown) => {
    state.planned.push(input);
    return state.plan(input);
  },
}));

const { submitPublicForm } = await import("../../app/(public)/form-actions");
const { PATH_HEADER } = await import("@/core/http/headers");

async function submit(): Promise<string> {
  const form = new FormData();
  form.set("form_slug", "contact");
  form.set("message", "Hello");
  try {
    await submitPublicForm(form);
  } catch (error) {
    return (error as { url?: string }).url ?? String(error);
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  state.after = [];
  state.planned = [];
});

describe("the public form action and measurement", () => {
  it("reads the path header the proxy sets", () => {
    expect(PATH_HEADER).toBe("x-freeholder-path");
  });

  it("schedules a planned conversion after the response", async () => {
    const task = vi.fn(async () => undefined);
    state.plan = async () => task;
    expect(await submit()).toBe("/contact?sent=contact");
    expect(state.planned).toHaveLength(1);
    expect(state.planned[0]).toMatchObject({
      submissionId: "00000000-0000-4000-8000-000000000009",
      consentCookie: "granted",
      path: "/contact",
    });
    expect(task).not.toHaveBeenCalled();
    expect(state.after).toEqual([task]);
  });

  it("schedules nothing when no conversion is planned", async () => {
    state.plan = async () => null;
    expect(await submit()).toBe("/contact?sent=contact");
    expect(state.after).toHaveLength(0);
  });

  it("still reports a saved enquiry as sent when planning fails", async () => {
    state.plan = async () => {
      throw new Error("settings unavailable");
    };
    expect(await submit()).toBe("/contact?sent=contact");
    expect(state.after).toHaveLength(0);
  });
});
