// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Failure-only diagnosis: never retain bodies, headers, queries, DOM or key material.
import { writeFile } from "node:fs/promises";
import type { ConsoleMessage, Page, Request, Response, TestInfo } from "@playwright/test";

export function diagnosticPath(value: string): string {
  try {
    const path = new URL(value).pathname;
    return /^\/messages(?:\/[0-9a-f-]{36})?$/.test(path) ? path : "[other route]";
  } catch { return "[unavailable]"; }
}

export function diagnosticText(value: string): string {
  if (/authorization|cookie|private.?key|passkey|recovery.?code|claim|secret|token|credential|bearer|csrf|password|api.?key/i.test(value)) return "[sensitive diagnostic omitted]";
  return value.replace(/https?:\/\/[^\s]+/g, diagnosticPath).replace(/[A-Za-z0-9+/_=-]{32,}/g, "[opaque]").slice(0, 300);
}

export function diagnosticErrors(value: unknown, depth = 0): Array<{ code: string; message?: string }> {
  if (!value || typeof value !== "object" || depth > 5) return [];
  const record = value as Record<string, unknown>;
  const result: Array<{ code: string; message?: string }> = [];
  const error = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : null;
  if (error && typeof error.code === "string" && /^[a-z_]{1,60}$/.test(error.code)) {
    result.push({ code: error.code, ...(typeof error.message === "string" ? { message: diagnosticText(error.message) } : {}) });
  }
  for (const child of Object.values(record).slice(0, 30)) result.push(...diagnosticErrors(child, depth + 1));
  return result.slice(0, 20);
}

export function observeGroupMessage(page: Page) {
  const began = Date.now();
  let sendStartedAt: number | null = null;
  const consoleEvents: Array<{ type: string; text: string }> = [];
  const responses: Array<{ path: string; elapsedMs: number; status: number; readComplete: boolean; errors: ReturnType<typeof diagnosticErrors> }> = [];
  const requests: Array<{ path: string; elapsedMs: number; finishedMs?: number; state: "pending" | "finished" | "failed"; failure?: string }> = [];
  const requestStates = new Map<Request, (typeof requests)[number]>();
  const pending = new Set<Promise<void>>();
  const isMessage = (request: Request) => request.method() === "POST" && diagnosticPath(request.url()).startsWith("/messages");
  const onRequest = (request: Request) => {
    if (!isMessage(request) || requests.length >= 100) return;
    const item: (typeof requests)[number] = { path: diagnosticPath(request.url()), elapsedMs: Date.now() - began, state: "pending" };
    requests.push(item); requestStates.set(request, item);
  };
  const onFinished = (request: Request) => {
    const item = requestStates.get(request);
    if (item) { item.state = "finished"; item.finishedMs = Date.now() - began; }
  };
  const onFailed = (request: Request) => {
    const item = requestStates.get(request);
    if (item) { item.state = "failed"; item.finishedMs = Date.now() - began; item.failure = diagnosticText(request.failure()?.errorText ?? "Unknown transport failure"); }
  };
  const onConsole = (event: ConsoleMessage) => {
    if (consoleEvents.length < 100 && ["error", "warning"].includes(event.type())) consoleEvents.push({ type: event.type(), text: diagnosticText(event.text()) });
  };
  const onPageError = (error: Error) => {
    if (consoleEvents.length < 100) consoleEvents.push({ type: "pageerror", text: diagnosticText(error.message) });
  };
  const onResponse = (response: Response) => {
    if (!isMessage(response.request()) || responses.length >= 100) return;
    const item: (typeof responses)[number] = { path: diagnosticPath(response.url()), elapsedMs: Date.now() - began, status: response.status(), readComplete: false, errors: [] };
    responses.push(item);
    const work = (async () => {
      try {
        const type = await response.headerValue("content-type");
        if (!type || !/text\/x-component|application\/json/.test(type)) return;
        // Only explicitly typed errors survive parsing; no response bytes are retained.
        const body = await response.text();
        for (const line of body.split("\n")) {
          const json = line.replace(/^[0-9a-f]+:/i, "");
          if (!json.startsWith("{") && !json.startsWith("[")) continue;
          try { item.errors.push(...diagnosticErrors(JSON.parse(json))); } catch { /* Non-JSON RSC record. */ }
        }
        item.errors = item.errors.slice(0, 20); item.readComplete = true;
      } catch { /* An incomplete read remains explicitly unknown. */ }
    })();
    pending.add(work); void work.finally(() => pending.delete(work));
  };
  page.on("request", onRequest); page.on("requestfinished", onFinished); page.on("requestfailed", onFailed);
  page.on("console", onConsole); page.on("pageerror", onPageError); page.on("response", onResponse);
  return {
    submitted() { sendStartedAt = Date.now(); },
    async attachFailure(info: TestInfo) {
      await Promise.race([Promise.allSettled([...pending]), new Promise(resolve => setTimeout(resolve, 500))]);
      const alerts = await page.getByRole("alert").allTextContents().catch(() => []);
      const buttons = await page.getByRole("button", { name: /send|sending/i }).evaluateAll(nodes => nodes.map(node => ({ label: node.textContent ?? "", disabled: (node as HTMLButtonElement).disabled }))).catch(() => []);
      const report = { path: diagnosticPath(page.url()), elapsedMs: Date.now() - began,
        sendElapsedMs: sendStartedAt === null ? null : Date.now() - sendStartedAt,
        alerts: alerts.slice(0, 20).map(diagnosticText), buttons: buttons.slice(0, 20).map(button => ({ ...button, label: diagnosticText(button.label) })),
        consoleEvents, requests, responses, pendingResponseReads: pending.size };
      const path = info.outputPath("group-message-allowlisted.json");
      await writeFile(path, JSON.stringify(report, null, 2));
      await info.attach("group-message-allowlisted", { path, contentType: "application/json" });
    },
    dispose() {
      page.off("request", onRequest); page.off("requestfinished", onFinished); page.off("requestfailed", onFailed);
      page.off("console", onConsole); page.off("pageerror", onPageError); page.off("response", onResponse);
    },
  };
}
