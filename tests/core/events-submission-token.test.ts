// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
// The registration form's submission token (C6.11) is minted in each
// browser, so a page a CDN shared between visitors carries no token anyone
// else could replay (2026-10-23 review).
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SubmissionTokenField } from "@/modules/events/SubmissionTokenField";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mounted(): Promise<string> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(SubmissionTokenField)));
  const value = host.querySelector<HTMLInputElement>('input[name="submissionToken"]')!.value;
  act(() => root.unmount());
  host.remove();
  return value;
}

describe("registration submission token", () => {
  it("is never in the server-rendered HTML a cache could share", () => {
    expect(renderToStaticMarkup(createElement(SubmissionTokenField))).toBe(
      '<input type="hidden" name="submissionToken" value=""/>',
    );
  });

  it("is minted per browser render, unguessable and distinct", async () => {
    const first = await mounted();
    const second = await mounted();
    expect(first).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(first).not.toBe(second);
  });
});
