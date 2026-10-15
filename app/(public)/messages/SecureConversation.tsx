// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.23: this browser's device, reading and writing end-to-end encrypted
// messages. The page around it is rendered by the server, which knows who
// sent what and when, but never what it said.
"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { E2eeDevice, type E2eeTransport, type ReadMessage } from "@/modules/members/e2ee/engine";
import { browserStore } from "@/modules/members/e2ee/idb-store";
import { Button, Callout, Field } from "@/ui/primitives";
import { attachmentsFrom } from "../m/attachment-form";
import {
  claimKeyPackagesAction,
  e2eeCommitAction,
  e2eeSyncAction,
  openConversationAction,
  publishKeyPackagesAction,
  registerDeviceAction,
  sendEncryptedAction,
  sendPlaintextAction,
} from "./e2ee-actions";

type Result<T> = { ok: T } | { error: { code: string; message: string } };
const field = (data: FormData, key: string): string => {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
};

async function unwrap<T>(pending: Promise<Result<T>>): Promise<T> {
  const result = await pending;
  if ("error" in result) throw Object.assign(new Error(result.error.message), { code: result.error.code });
  return result.ok;
}

const transport: E2eeTransport = {
  register: (input) => unwrap(registerDeviceAction(input)),
  publish: (input) => unwrap(publishKeyPackagesAction(input)),
  sync: (input) => unwrap(e2eeSyncAction(input)),
  claim: (input) => unwrap(claimKeyPackagesAction(input)),
  commit: (input) => unwrap(e2eeCommitAction(input)),
  send: (input) => unwrap(sendEncryptedAction(input)),
};

/** A name the member will recognise in their device list. */
function browserLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Firefox\//.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

let current: { userId: string; device: E2eeDevice } | null = null;
export function deviceFor(userId: string): E2eeDevice {
  if (current?.userId !== userId) current = { userId, device: new E2eeDevice(userId, browserStore, transport, browserLabel()) };
  return current.device;
}

type Phase = "loading" | "ready" | "joining" | "plaintext" | "failed";
interface Secure {
  phase: Phase;
  messages: Map<string, ReadMessage>;
  missing: string[];
  refresh: () => Promise<void>;
  send: (body: string, attachments: { assetId: string; altText: string }[]) => Promise<"sent" | "plaintext">;
}
const SecureContext = createContext<Secure | null>(null);

export function SecureConversation({ conversationId, userId, children }: { conversationId: string; userId: string; children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [messages, setMessages] = useState<Map<string, ReadMessage>>(new Map());
  const [missing, setMissing] = useState<string[]>([]);
  const refresh = useCallback(async () => {
    try {
      const status = await deviceFor(userId).sync(conversationId);
      setMessages(status.messages);
      setMissing(status.missing);
      setPhase(!status.available ? "plaintext" : status.ready ? "ready" : "joining");
    } catch {
      setPhase("failed");
    }
  }, [conversationId, userId]);
  useEffect(() => {
    void refresh();
    const again = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [refresh]);
  const send = useCallback(async (body: string, attachments: { assetId: string; altText: string }[]) => {
    const id = await deviceFor(userId).send(conversationId, body, attachments);
    await refresh();
    return id ? "sent" : "plaintext";
  }, [conversationId, userId, refresh]);
  return <SecureContext.Provider value={{ phase, messages, missing, refresh, send }}>{children}</SecureContext.Provider>;
}

export function SecureStatus({ labels }: { labels: { encrypted: string; joining: string; plaintext: string; failed: string } }) {
  const secure = useContext(SecureContext);
  if (!secure || secure.phase === "loading") return null;
  if (secure.phase === "ready") return <p className="text-sm text-ink-muted">{labels.encrypted}</p>;
  if (secure.phase === "joining") return <Callout>{labels.joining}</Callout>;
  if (secure.phase === "plaintext") return <Callout>{labels.plaintext}</Callout>;
  return <Callout tone="danger">{labels.failed}</Callout>;
}

/** The body of an encrypted message, as this device read it. */
export function SecureBody({ id, labels }: { id: string; labels: { loading: string; unreadable: string; before: string } }) {
  const secure = useContext(SecureContext);
  const read = secure?.messages.get(id);
  if (read?.ok) return <p className="whitespace-pre-line break-words" data-secure-body={id}>{read.body}</p>;
  const text = !secure || secure.phase === "loading" ? labels.loading : read ? labels.unreadable : labels.before;
  return <p className="italic text-ink-muted">{text}</p>;
}

/** The reply box. Encrypts on this device; plaintext only while someone has no device yet. */
export function SecureComposer({ conversationId, fallback, labels, children }: { conversationId: string; fallback: (form: FormData) => Promise<void>; labels: { body: string; send: string; sending: string; failed: string }; children?: ReactNode }) {
  const secure = useContext(SecureContext);
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    if (!secure || secure.phase === "plaintext") return; // the server action sends it
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body = field(data, "body");
    if (!body) return;
    setBusy(true);
    setFailed(false);
    try {
      const outcome = await secure.send(body, attachmentsFrom(data));
      if (outcome === "plaintext") await unwrap(sendPlaintextAction({ conversationId, body, attachments: attachmentsFrom(data) }));
      form.current?.reset();
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  const blocked = !secure || secure.phase === "loading" || secure.phase === "joining" || secure.phase === "failed";
  return (
    <form ref={form} action={fallback} onSubmit={(event) => { void submit(event); }} className="grid gap-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="verb" value="send" />
      {failed ? <Callout tone="danger">{labels.failed}</Callout> : null}
      <Field label={labels.body} htmlFor="reply-body">
        <textarea id="reply-body" name="body" required maxLength={10000} rows={3} className="w-full rounded-md border border-rule-strong bg-field px-3 py-2 text-sm" />
      </Field>
      {children}
      <Button type="submit" disabled={busy || blocked}>{busy ? labels.sending : labels.send}</Button>
    </form>
  );
}

/** Starting a conversation: the conversation is opened, then the first message is encrypted here. */
export function NewConversation({ userId, fallback, labels, children }: { userId: string; fallback: (form: FormData) => Promise<void>; labels: { send: string; sending: string; failed: string }; children: ReactNode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Opening messages sets this browser up as a device, so others can encrypt to it.
  useEffect(() => { void deviceFor(userId).device().catch(() => undefined); }, [userId]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const handles = field(data, "to").split(/[\s,]+/).map((h) => h.replace(/^@/, "")).filter(Boolean);
    const title = field(data, "title") || undefined;
    const body = field(data, "body");
    setBusy(true);
    setFailed(false);
    try {
      const { id } = await unwrap(openConversationAction({ handles, title }));
      const sent = await deviceFor(userId).send(id, body);
      if (!sent) await unwrap(sendPlaintextAction({ conversationId: id, body, attachments: [] }));
      router.push(`/messages/${id}`);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }
  return (
    <form action={fallback} onSubmit={(event) => { void submit(event); }} className="grid gap-3 rounded-lg border border-rule bg-surface p-4">
      {failed ? <Callout tone="danger">{labels.failed}</Callout> : null}
      {children}
      <Button type="submit" disabled={busy}>{busy ? labels.sending : labels.send}</Button>
    </form>
  );
}

/** On the report form: what this device read, and the key that proves it. */
export function FrankingFields({ conversationId, messageId, userId }: { conversationId: string; messageId: string; userId: string }) {
  const [read, setRead] = useState<ReadMessage | null>(null);
  useEffect(() => {
    void deviceFor(userId).sync(conversationId).then((s) => setRead(s.messages.get(messageId) ?? null)).catch(() => setRead(null));
  }, [conversationId, messageId, userId]);
  if (!read?.ok) return null;
  return (
    <>
      <input type="hidden" name="frankBody" value={read.body} />
      <input type="hidden" name="frankKey" value={read.fk} />
      <blockquote className="whitespace-pre-line break-words border-s-4 border-rule ps-3 text-sm">{read.body}</blockquote>
    </>
  );
}
