// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// The admin shell's backstop for a refused form.
//
// Admin actions report a refusal by redirecting with `?error=<sentence>`, and
// most screens render it. Some never did — adding an event that the service
// refused set the parameter and showed nothing, so the owner (or a playground
// visitor) saw the same page and assumed it had worked. Rather than trust
// every screen to remember, the shell shows the sentence itself whenever the
// screen did not: after the page has rendered, if no alert inside the main
// region already carries the message, this one does.
//
// Only sentences: some screens use one-word codes they translate themselves
// (`?error=failed`), and echoing a code would be worse than the screen's own
// handling.
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export function ActionErrorFallback() {
  const message = useSearchParams().get("error");
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!message || !message.includes(" ")) {
      setShow(false);
      return;
    }
    const main = document.getElementById("main-content");
    const alerts = Array.from(main?.querySelectorAll('[role="alert"], [role="status"], .text-danger') ?? []);
    setShow(!alerts.some((element) => element.textContent?.includes(message)));
  }, [message]);

  if (!show || !message) return null;
  return (
    <p
      role="alert"
      className="mb-6 rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger"
    >
      {message}
    </p>
  );
}
