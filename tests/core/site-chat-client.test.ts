// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { requireCsrf } from "@/core/http/csrf";
import { SiteChatClient } from "@/modules/cms/blocks/SiteChatClient";

vi.mock("../../app/(public)/inbound-actions", () => ({ postSiteChatAction: vi.fn() }));

afterEach(() => { vi.unstubAllGlobals(); document.cookie = "freeholder_csrf=; Max-Age=0; Path=/"; });

it("signed-in chat sends double-submit CSRF on message, assistant and End; other block placements offer no media admission", async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  document.cookie = "freeholder_csrf=fixture-token; Path=/";
  const writes: string[] = [];
  const transcript = { state: "open", escalated: false, messages: [], expiresAt: "2026-12-01T00:00:00Z" };
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    expect(url).not.toBe("/api/chat/assistant/call");
    if (method !== "GET") {
      const headers = new Headers(init?.headers);
      // The login cookie remains httpOnly. Model the HTTP guard's automatic credential attachment.
      headers.set("cookie", `freeholder_session=fixture-session; ${document.cookie}`);
      requireCsrf(new Request(`https://business.test${url}`, { method, headers }));
      writes.push(`${method} ${url}`);
    }
    return new Response(JSON.stringify(url.endsWith("/assistant") ? { status: "answered" } : transcript), { headers: { "content-type": "application/json" } });
  });
  const labels = {
    call: { label:"AI", captions:"Captions", video:"Video", voice:"Voice", leave:"Leave", end:"End call", waiting:"Waiting", unavailable:"Text", connecting:"Connecting", captionFailed:"Failed", ended:"Ended", lost:"Lost", microphone:"Microphone",voiceFallback:"Voice fallback" },
    loading:"Loading",ended:"Ended",escalated:"Escalated",message:"Message",send:"Send",sending:"Sending",end:"End chat",fromYou:"You",fromBusiness:"Business",fromAssistant:"Assistant",failed:"Failed",
  };
  const container=document.createElement("div");document.body.append(container);const root=createRoot(container);
  try {
    await act(async () => {root.render(createElement(SiteChatClient,{locale:"fr",labels,path:"/fr/services"}));});
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});
    expect(container.textContent).not.toContain("End call");
    container.querySelector("textarea")!.value="A follow-up";
    // React receives the browser's actual FormData implementation for a submitted HTML form.
    vi.stubGlobal("FormData",window.FormData);
    await act(async()=>{container.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});
    const end=[...container.querySelectorAll("button")].find(button=>button.textContent==="End chat")!;
    await act(async()=>{end.click();});
    expect(writes).toEqual(["POST /api/chat","POST /api/chat/assistant","DELETE /api/chat"]);
    expect(container.textContent).toContain("Ended");
  } finally {await act(async()=>root.unmount());container.remove();}
});
