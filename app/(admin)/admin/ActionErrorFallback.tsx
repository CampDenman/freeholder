// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// The admin shell's backstop for a refused form.
//
// Admin actions report a refusal by redirecting with `?error=…`, and most
// screens render it. Some never did — adding an event that the service
// refused showed nothing, so the owner (or a playground visitor) saw the same
// page and assumed it had worked. Rather than trust every screen to remember,
// the shell shows the refusal itself whenever the screen did not.
//
// The sentence shown is never the URL's: anybody can write a link with
// `?error=` text, and echoing it inside the trusted admin would be a phishing
// page. The action that refused records the sentence in an httpOnly flash
// cookie (`flashAdminError`); the URL parameter only says "look for one".
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { takeAdminError } from "../admin-flash-actions";

export function ActionErrorFallback() {
  const flagged = useSearchParams().has("error");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    if (!flagged) {
      setMessage(null);
      return;
    }
    void takeAdminError().then((flashed) => {
      if (!live || !flashed) return;
      const main = document.getElementById("main-content");
      const shown = Array.from(
        main?.querySelectorAll('[role="alert"], [role="status"], .text-danger') ?? [],
      ).some((element) => element.textContent?.includes(flashed));
      setMessage(shown ? null : flashed);
    });
    return () => {
      live = false;
    };
  }, [flagged]);

  if (!message) return null;
  return (
    <p
      role="alert"
      className="mb-6 rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger"
    >
      {message}
    </p>
  );
}
