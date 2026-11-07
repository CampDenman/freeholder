// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewAssistantCall, type PreviewAssistantLabels } from "@/modules/cms/blocks/PreviewAssistantCall";

const labels: PreviewAssistantLabels = {
  label: "AI assistant", captions: "Captions stay in this chat", video: "Start video", voice: "Start voice", leave: "Leave queue", end: "End call",
  waiting: "Waiting", unavailable: "Use text", connecting: "Connecting", captionFailed: "Captions not saved", ended: "Ended", lost: "Connection lost", microphone: "Allow microphone",
  voiceFallback: "Video is unavailable. Continuing by voice.",
};
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const config = (modes = ["video", "voice", "text"]) => json({ enabled: true, modes, label: "AI assistant", disclosure: "AI, family-friendly, no endorsement" });
const tick = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("preview assistant browser lifecycle", () => {
  let root: Root, container: HTMLDivElement;
  const stops: Array<ReturnType<typeof vi.fn>> = [];
  const requests: Array<Record<string, unknown>> = [];
  let handler: (body: Record<string, unknown>) => Promise<Response>;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    stops.length = 0; requests.length = 0;
    vi.stubGlobal("AudioContext", class {
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
    });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => {
      const stop = vi.fn(); stops.push(stop);
      return Promise.resolve({ getTracks: () => [{ stop }] });
    } } });
    vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
      requests.push(body); return handler(body);
    });
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
  async function mount() { await act(async () => root.render(createElement(PreviewAssistantCall, { ended: false, labels }))); await tick(); }
  async function click(text: string) {
    const button = [...container.querySelectorAll("button")].find(item => item.textContent === text);
    expect(button, text).toBeDefined();
    await act(async () => button!.click()); await tick();
  }

  it("keeps disclosure and text fallback without requesting microphone or age confirmation", async () => {
    handler = async () => config(["text"]); await mount();
    expect(container.textContent).toContain("no endorsement");
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(stops).toHaveLength(0);
  });

  it("a canceled older start cannot stop the next call when its response later fails", async () => {
    const first = deferred<Response>(), second = deferred<Response>(); let starts = 0;
    handler = body => body.action === "config" ? Promise.resolve(config())
      : body.action === "start" ? (++starts === 1 ? first.promise : second.promise)
        : Promise.resolve(json({ status: "ended" }));
    await mount(); await click(labels.voice); expect(stops).toHaveLength(1);
    await click(labels.end); expect(stops[0]).toHaveBeenCalledTimes(1);
    await click(labels.voice); expect(stops).toHaveLength(2);
    await act(async () => first.reject(new Error("old response lost"))); await tick();
    expect(stops[1]).not.toHaveBeenCalled();
    expect(container.textContent).toContain(labels.end);
    expect(container.textContent).toContain(labels.connecting);
    await act(async () => second.resolve(json({ status: "text" }))); await tick();
    expect(stops[1]).toHaveBeenCalledTimes(1);
  });

  it("leaving a queue stops local media and ends that exact bound ticket", async () => {
    handler = async body => body.action === "config" ? config()
      : body.action === "start" ? json({ status: "queued", session_id: "11111111-1111-4111-8111-111111111111" })
        : json({ status: "expired" });
    await mount(); await click(labels.video); expect(container.textContent).toContain(labels.waiting);
    await click(labels.leave);
    expect(stops[0]).toHaveBeenCalledTimes(1);
    expect(requests.at(-1)).toEqual({ action: "end", sessionId: "11111111-1111-4111-8111-111111111111" });
    expect(container.textContent).toContain(labels.video);
  });
});
