// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { postSiteChatAction } from "../../../../app/(public)/inbound-actions";

interface ChatMessage {
  id: string;
  direction: "inbound" | "outbound";
  channel: "chat" | "assistant";
  body: string;
  occurredAt: string;
}

interface Transcript {
  state: "open" | "closed";
  escalated: boolean;
  messages: ChatMessage[];
  expiresAt: string;
}

interface Labels {
  loading: string;
  ended: string;
  escalated: string;
  message: string;
  send: string;
  sending: string;
  end: string;
  fromYou: string;
  fromBusiness: string;
  fromAssistant: string;
  failed: string;
}

function errorMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object" || !("error" in value)) return fallback;
  const error = (value as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return fallback;
}

export function SiteChatClient({ locale, labels }: { locale: string; labels: Labels }) {
  const [chat, setChat] = useState<Transcript | null>(null);
  const [ended, setEnded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/chat", { cache: "no-store", signal });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 404) setEnded(true);
        else setError(errorMessage(body, labels.failed));
        return;
      }
      setChat(body as Transcript);
      setEnded((body as Transcript).state === "closed");
      setError("");
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(labels.failed);
    }
  }, [labels.failed]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 5_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [refresh]);

  /**
   * Give the front-site assistant (C9.21) a chance to answer, if there is one.
   *
   * Optional in every direction: the endpoint 404s on an instance without the
   * module, returns `{ status: "off" }` on one that has not switched it on,
   * and any failure here is silence rather than an error — the visitor's
   * message is already recorded and a person can still reply to it.
   */
  const askAssistant = useCallback(async () => {
    try {
      const response = await fetch("/api/chat/assistant", { method: "POST" });
      if (!response.ok) return;
      const body: unknown = await response.json().catch(() => ({}));
      if ((body as { status?: string }).status === "answered") await refresh();
    } catch {
      // Nothing to tell the visitor: they were talking to the business, and
      // they still are.
    }
  }, [refresh]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const message = data.get("message");
    if (typeof message !== "string" || !message.trim()) {
      setError(labels.failed);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(errorMessage(body, labels.failed));
        return;
      }
      setChat(body as Transcript);
      form.reset();
      await askAssistant();
    } catch {
      setError(labels.failed);
    } finally {
      setBusy(false);
    }
  }

  async function end() {
    setBusy(true);
    try {
      const response = await fetch("/api/chat", { method: "DELETE" });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => ({}));
        setError(errorMessage(body, labels.failed));
        return;
      }
      setEnded(true);
      setChat((current) => current ? { ...current, state: "closed" } : current);
    } catch {
      setError(labels.failed);
    } finally {
      setBusy(false);
    }
  }

  if (!chat && !ended) {
    return <p role="status" className="text-sm text-ink-muted">{labels.loading}</p>;
  }

  return (
    <section aria-label={labels.message} className="grid max-w-xl gap-4 border-s-4 border-accent ps-4">
      {chat?.escalated ? (
        <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
          {labels.escalated}
        </p>
      ) : null}
      <ol aria-live="polite" aria-relevant="additions" className="grid max-h-96 list-none gap-3 overflow-y-auto p-0 pe-1">
        {(chat?.messages ?? []).map((message) => {
          const fromVisitor = message.direction === "inbound";
          const who = fromVisitor
            ? labels.fromYou
            : message.channel === "assistant"
              ? labels.fromAssistant
              : labels.fromBusiness;
          return (
            <li
              key={message.id}
              className={`grid max-w-[88%] gap-1 rounded-md border border-rule px-3 py-2 text-sm ${
                fromVisitor ? "ms-auto bg-accent-soft" : "bg-surface"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                <span className="font-semibold text-ink">{who}</span>
                <time dateTime={message.occurredAt}>
                  {new Intl.DateTimeFormat(locale, {
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(new Date(message.occurredAt))}
                </time>
              </div>
              <p className="whitespace-pre-wrap text-ink">{message.body}</p>
            </li>
          );
        })}
      </ol>

      {ended || chat?.state === "closed" ? (
        <p role="status" className="text-sm text-ink-muted">{labels.ended}</p>
      ) : (
        <>
          <form onSubmit={(event) => { void send(event); }} className="grid gap-2">
            <label className="grid gap-1 text-sm">
              <span className="font-semibold text-ink">{labels.message}</span>
              <textarea
                name="message"
                required
                maxLength={4_000}
                rows={3}
                className="w-full rounded-md border border-rule bg-field px-3 py-2 text-ink"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={busy} className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-60">
                {busy ? labels.sending : labels.send}
              </button>
              <button type="button" disabled={busy} onClick={() => void end()} className="text-sm underline disabled:opacity-60">
                {labels.end}
              </button>
            </div>
          </form>
          <noscript>
            <form action={(form) => { void postSiteChatAction(form); }} className="grid gap-2">
              <label className="grid gap-1 text-sm">
                <span className="font-semibold text-ink">{labels.message}</span>
                <textarea name="message" required maxLength={4_000} rows={3} className="w-full rounded-md border border-rule bg-field px-3 py-2 text-ink" />
              </label>
              <button type="submit" className="w-fit rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent">{labels.send}</button>
            </form>
          </noscript>
        </>
      )}
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    </section>
  );
}
