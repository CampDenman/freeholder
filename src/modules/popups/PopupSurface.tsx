// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// The popup, as a visitor meets it (MASTER.md §36, C9.30).
//
// ── Why a native <dialog> ─────────────────────────────────────────────────
//
// A modal has four obligations: focus goes into it, focus stays inside it,
// Escape closes it, and focus returns to where it was. Every one of those is
// something a hand-rolled `role="dialog"` gets wrong eventually — the focus
// trap that misses a link added later, the Escape handler that fires while
// somebody is typing in a select, the return focus that lands on <body>. The
// browser implements all four, correctly, for `showModal()`.
//
// So the accessibility of this surface is not a behaviour written here. It is
// a behaviour delegated to the platform that already ships it, and what is
// written here is the small set of decisions the browser cannot make.
//
// Three of those decisions are worth naming:
//
//   - **Only `modal` traps focus.** A banner and a corner card are not modal:
//     they sit in the page, they do not take focus, and taking it would
//     interrupt somebody mid-sentence to show them an announcement. They are
//     labelled regions with a close button, which is what they are.
//   - **The close control is first in the DOM.** `showModal()` focuses the
//     first focusable descendant, so the first thing a keyboard or screen
//     reader user meets in an interruption nobody asked for is the way out of
//     it. It is positioned at the top corner visually and reads first
//     regardless.
//   - **Nothing opens over somebody who is typing.** A delay or an exit-intent
//     that fires while a visitor is filling in a form takes their focus and
//     their next keystroke. The trigger waits instead.
//
// The visitor's identity is not handled here at all. The API route reads the
// first-party cookies itself, which is why this component sends only a popup
// id and a path: a client that cannot name a visitor cannot be persuaded to
// name the wrong one.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { X } from "@phosphor-icons/react/dist/ssr";

export interface PopupSurfaceLabels {
  dismiss: string;
  email: string;
  join: string;
  sending: string;
  failed: string;
  pending: string;
  success: string;
}

export interface PopupSurfaceProps {
  id: string;
  title: string;
  surface: "modal" | "banner" | "corner";
  trigger: "immediate" | "delay" | "scroll" | "exitIntent";
  triggerValue: number;
  captureMode: "none" | "email";
  consentStatement: string | null;
  path: string;
  labels: PopupSurfaceLabels;
  /** The block tree, already rendered on the server. */
  children: ReactNode;
}

/** Somebody mid-sentence is not somebody to interrupt. */
function visitorIsTyping(): boolean {
  const active = document.activeElement;
  if (!active || !(active instanceof HTMLElement)) return false;
  if (active.isContentEditable) return true;
  const tag = active.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Exit intent, as honestly as a browser can report it.
 *
 * The pointer leaving through the top of the window is the only signal that
 * means anything, and it means nothing at all on a touch screen — there is no
 * cursor to leave. Rather than substituting a timer and calling it intent,
 * coarse pointers simply never fire this: an "exit intent" popup on a phone
 * would be a popup at a moment nobody chose.
 */
function exitIntentSupported(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: fine)").matches
  );
}

async function report(event: "shown" | "dismissed", id: string, path: string) {
  try {
    await fetch("/api/popups", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, popupId: id, path }),
    });
  } catch {
    // A cap that cannot be recorded is a cap that will show one impression too
    // many, which is a nuisance. Failing the visitor's page over it would be
    // worse than the nuisance.
  }
}

export function PopupSurface(props: PopupSurfaceProps) {
  const { id, surface, trigger, triggerValue, path, labels } = props;
  const [open, setOpen] = useState(false);
  const [captured, setCaptured] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const shownRef = useRef(false);
  const closedRef = useRef(false);
  const deferralsRef = useRef(0);

  // Annotated because the body refers to itself when it defers, and an
  // inferred type cannot close that loop.
  const show: () => void = useCallback(() => {
    if (shownRef.current || closedRef.current) return;
    // Deferred rather than dropped. Somebody typing in a form, or on a tab
    // they are not looking at, is not somebody to interrupt — but a delay
    // trigger fires once, so treating that as "never mind" would silently
    // lose the popup for exactly the visitors who were most engaged. Bounded
    // at a minute so a page left open in a text field is not also a timer
    // running for the rest of the day.
    if (document.visibilityState !== "visible" || visitorIsTyping()) {
      if (deferralsRef.current >= 12) return;
      deferralsRef.current += 1;
      window.setTimeout(show, 5_000);
      return;
    }
    shownRef.current = true;
    setOpen(true);
    void report("shown", id, path);
  }, [id, path]);

  const dismiss = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    setOpen(false);
    // A capture is not a dismissal. Recording one as the other would tell the
    // owner their popup is being closed by the people it is working on.
    if (!captured) void report("dismissed", id, path);
  }, [captured, id, path]);

  /* ------------------------------------------------------------- triggers */
  useEffect(() => {
    if (trigger === "immediate") {
      show();
      return;
    }
    if (trigger === "delay") {
      const timer = window.setTimeout(show, Math.max(0, triggerValue) * 1000);
      return () => window.clearTimeout(timer);
    }
    if (trigger === "scroll") {
      const onScroll = () => {
        const scrollable =
          document.documentElement.scrollHeight - window.innerHeight;
        // A page shorter than the viewport can never be scrolled through, so
        // the threshold is already met rather than never met.
        const percent =
          scrollable <= 0 ? 100 : (window.scrollY / scrollable) * 100;
        if (percent >= triggerValue) show();
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
      return () => window.removeEventListener("scroll", onScroll);
    }
    if (!exitIntentSupported()) return;
    const onOut = (event: MouseEvent) => {
      if (event.clientY <= 0 && !event.relatedTarget) show();
    };
    document.addEventListener("mouseout", onOut);
    return () => document.removeEventListener("mouseout", onOut);
  }, [show, trigger, triggerValue]);

  /* --------------------------------------------------------- modal opening */
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || surface !== "modal") return;
    // Feature-detected rather than assumed: `showModal` is what makes the
    // focus trap real, and a rendering environment without it should leave the
    // dialog closed rather than show an untrapped one.
    if (open && !dialog.open && typeof dialog.showModal === "function") {
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, surface]);

  if (!open) return null;

  return (
    <PopupChrome
      id={id}
      title={props.title}
      surface={surface}
      dismissLabel={labels.dismiss}
      onDismiss={dismiss}
      onClose={dismiss}
      dialogRef={dialogRef}
    >
      {captured ? (
        <p role="status" className="text-sm text-success">
          {captured}
        </p>
      ) : (
        <>
          <div className="grid gap-3 text-ink">{props.children}</div>
          {props.captureMode === "email" ? (
            <CaptureForm
              id={id}
              path={path}
              consentStatement={props.consentStatement ?? ""}
              labels={labels}
              onCaptured={(message) => {
                setCaptured(message);
                closedRef.current = false;
              }}
            />
          ) : null}
        </>
      )}
    </PopupChrome>
  );
}

/**
 * The markup, with nothing in it that depends on when the popup opened.
 *
 * Separated from the component above so the accessibility of this surface can
 * be *audited* rather than asserted: the timing logic needs a browser, but the
 * markup does not, and `tests/modules/popups.test.ts` renders exactly this and
 * runs axe over it. A dialog whose close button loses its accessible name is
 * then a failing build rather than a bug report from somebody who could not
 * shut it.
 */
export function PopupChrome({
  id,
  title,
  surface,
  dismissLabel,
  onDismiss,
  onClose,
  dialogRef,
  children,
}: {
  id: string;
  title: string;
  surface: "modal" | "banner" | "corner";
  dismissLabel: string;
  onDismiss?: () => void;
  onClose?: () => void;
  dialogRef?: RefObject<HTMLDialogElement | null>;
  children: ReactNode;
}) {
  const body = (
    <>
      {/* First in the DOM on purpose: `showModal()` focuses the first
          focusable descendant, so the way out of an interruption nobody asked
          for is the first thing a keyboard or a screen reader meets. It is
          placed at the corner visually and still reads first. */}
      <button
        type="button"
        onClick={onDismiss}
        aria-label={dismissLabel}
        className="absolute end-2 top-2 inline-flex h-9 w-9 items-center justify-center rounded-md border border-rule bg-surface text-ink"
      >
        <X size={16} weight="bold" aria-hidden="true" />
      </button>
      <h2 id={`popup-title-${id}`} className="pe-10 text-lg font-bold tracking-tight text-ink">
        {title}
      </h2>
      {children}
    </>
  );

  if (surface === "modal") {
    return (
      <dialog
        ref={dialogRef}
        aria-labelledby={`popup-title-${id}`}
        onClose={onClose}
        className="relative m-auto grid w-[min(32rem,calc(100vw-2rem))] gap-4 rounded-lg border border-rule bg-surface p-6 text-ink shadow-float backdrop:bg-ink/40"
      >
        {body}
      </dialog>
    );
  }

  // Both non-modal surfaces are fixed to the bottom of the viewport, and
  // neither is at the top. Two reasons, and they are not aesthetic: the
  // platform already has a top announcement bar as chrome (§32), so a second
  // one would be two answers to the same question; and a bar that arrives four
  // seconds after paint and pushes the article down is the Core Web Vitals
  // failure §4.16 refuses for ads, which does not stop being a failure because
  // this time it is the owner's own message. The corner card sits at the start
  // edge, clear of the analytics choice control at the end edge.
  return (
    <section
      aria-labelledby={`popup-title-${id}`}
      aria-live="polite"
      className={
        surface === "banner"
          ? "fixed inset-x-0 bottom-0 z-40 grid gap-3 border-t border-rule bg-surface px-6 py-4 text-ink shadow-float"
          : "fixed bottom-4 start-4 z-40 grid w-[min(24rem,calc(100vw-2rem))] gap-3 rounded-lg border border-rule bg-surface p-5 text-ink shadow-float"
      }
    >
      {body}
    </section>
  );
}

function CaptureForm({
  id,
  path,
  consentStatement,
  labels,
  onCaptured,
}: {
  id: string;
  path: string;
  consentStatement: string;
  labels: PopupSurfaceLabels;
  onCaptured: (message: string) => void;
}) {
  const [state, setState] = useState<"idle" | "sending" | "failed">("idle");
  const [error, setError] = useState<string>("");

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        setState("sending");
        setError("");
        void fetch("/api/popups", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            event: "capture",
            popupId: id,
            path,
            // `FormData.get` can hand back a File, which stringifies to
            // "[object File]" — a captured address nobody could email. Only a
            // string is an address.
            email: typeof data.get("email") === "string" ? (data.get("email") as string) : "",
            // The box, not the button. A submit that implies consent is a
            // consent record nobody could defend, and the server refuses it.
            consent: data.get("consent") === "on",
          }),
        })
          .then(async (response) => {
            const result = (await response.json().catch(() => null)) as
              | { ok?: true; message?: string | null; pending?: boolean; error?: string }
              | null;
            if (!response.ok || !result?.ok) {
              setState("failed");
              setError(result?.error ?? labels.failed);
              return;
            }
            onCaptured(result.message ?? (result.pending ? labels.pending : labels.success));
          })
          .catch(() => {
            setState("failed");
            setError(labels.failed);
          });
      }}
    >
      <label className="grid gap-1 text-sm">
        <span className="font-semibold text-ink">{labels.email}</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          className="rounded-md border border-rule bg-field px-3 py-2 text-ink"
        />
      </label>
      <label className="flex items-start gap-2 text-sm text-ink-muted">
        <input type="checkbox" name="consent" required className="mt-1" />
        <span>{consentStatement}</span>
      </label>
      {state === "failed" ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={state === "sending"}
        className="w-fit rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent shadow-press"
      >
        {state === "sending" ? labels.sending : labels.join}
      </button>
    </form>
  );
}
