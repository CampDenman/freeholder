// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.33, C3.34: the booking intake form is the same form as on a page, with
// the same notice, so it is sealed the same way before `forms.submit` — with
// the visitor's address for screening, and the seal passed through intact.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  sealed: [] as unknown[],
  submitted: [] as Array<{ input: Record<string, unknown>; actor: Record<string, unknown> }>,
  attached: [] as unknown[],
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/core/http/request-metadata", () => ({
  requestMetadataFromHeaders: () => ({ ip: "203.0.113.9", userAgent: "Agent/1.0" }),
}));
vi.mock("@/core/scheduling/bookings", () => ({ cancelByToken: {}, rescheduleByToken: {} }));
vi.mock("@/modules/forms/screening", () => ({
  sealSiteSubmission: (input: unknown) => {
    state.sealed.push(input);
    return Promise.resolve("v1.allow.1.sig");
  },
}));
vi.mock("@/modules/forms/service", () => ({
  submitForm: {
    call: (input: Record<string, unknown>, actor: Record<string, unknown>) => {
      state.submitted.push({ input, actor });
      return Promise.resolve({ ok: true, submissionId: "00000000-0000-4000-8000-00000000000a", message: "ok" });
    },
  },
}));
vi.mock("@/core/scheduling/requirements", () => ({
  attachIntakeByToken: {
    call: (input: unknown) => {
      state.attached.push(input);
      return Promise.resolve({ ok: true });
    },
  },
}));

const { submitIntakeAction } = await import("../../app/portal/appointments/actions");

beforeEach(() => {
  state.sealed = [];
  state.submitted = [];
  state.attached = [];
});

describe("the booking intake form", () => {
  it("is sealed with the visitor's address before forms.submit, and the seal is passed through", async () => {
    const form = new FormData();
    form.set("bookingToken", "tok");
    form.set("form_slug", "intake");
    form.set("message", "Allergic to cats");
    let redirected = "";
    try {
      await submitIntakeAction(form);
    } catch (error) {
      redirected = (error as { url?: string }).url ?? "";
    }
    expect(redirected).toBe("/portal/appointments/tok?saved=intake");
    expect(state.sealed).toEqual([
      { slug: "intake", values: { message: "Allergic to cats" }, request: { ip: "203.0.113.9", userAgent: "Agent/1.0" } },
    ]);
    expect(state.submitted).toHaveLength(1);
    expect(state.submitted[0]!.input).toMatchObject({ slug: "intake", screening: "v1.allow.1.sig" });
    expect(state.submitted[0]!.actor).toEqual({
      kind: "anonymous",
      request: { ip: "203.0.113.9", userAgent: "Agent/1.0" },
    });
    expect(state.attached).toHaveLength(1);
  });
});
