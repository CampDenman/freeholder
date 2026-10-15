// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.22: turn push notifications on or off in this browser.
"use client";
import { useEffect, useState, useTransition } from "react";
import { Button, Callout } from "@/ui/primitives";
import { pushKeyAction, subscribePushAction, unsubscribePushAction } from "./actions";

type State = "unsupported" | "blocked" | "off" | "on";
type Labels = { on: string; off: string; turnOn: string; turnOff: string; unsupported: string; blocked: string; failed: string };

export function PushToggle({ labels }: { labels: Labels }) {
  const [state, setState] = useState<State>("off");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("blocked");
      return;
    }
    void navigator.serviceWorker.getRegistration("/").then(async (registration) => {
      setState((await registration?.pushManager.getSubscription()) ? "on" : "off");
    });
  }, []);
  function turnOn() {
    setError("");
    startTransition(async () => {
      try {
        if ((await Notification.requestPermission()) !== "granted") {
          setState("blocked");
          return;
        }
        const registration = await navigator.serviceWorker.register("/push-sw.js", { scope: "/" });
        const { publicKey } = await pushKeyAction();
        const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
        const json = subscription.toJSON();
        const saved = await subscribePushAction({ endpoint: json.endpoint ?? "", p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" });
        if (saved.error) {
          await subscription.unsubscribe();
          setError(saved.error);
          return;
        }
        setState("on");
      } catch {
        setError(labels.failed);
      }
    });
  }
  function turnOff() {
    setError("");
    startTransition(async () => {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await unsubscribePushAction(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setState("off");
    });
  }
  return (
    <div className="grid gap-2">
      {error ? <Callout tone="danger">{error}</Callout> : null}
      {state === "unsupported" ? <p className="text-sm text-ink-muted">{labels.unsupported}</p> : null}
      {state === "blocked" ? <p className="text-sm text-ink-muted">{labels.blocked}</p> : null}
      {state === "on" ? <p className="text-sm">{labels.on} <Button type="button" variant="quiet" disabled={pending} onClick={turnOff}>{labels.turnOff}</Button></p> : null}
      {state === "off" ? <p className="text-sm">{labels.off} <Button type="button" disabled={pending} onClick={turnOn}>{labels.turnOn}</Button></p> : null}
    </div>
  );
}
