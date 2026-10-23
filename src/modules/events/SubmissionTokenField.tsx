// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// The registration form's one-time submission token (C6.11), minted in the
// visitor's own browser.
//
// It is deliberately not rendered by the server. A server-rendered secret is
// only as private as the response that carries it, and the playground lets a
// CDN share cookie-less CMS pages between visitors for a few seconds — so a
// token in the HTML could be one token for everyone who loaded the page in
// that window, and anyone among them could replay another's registration.
// The HTML carries an empty field; each browser fills its own. A double
// click or a retry of this form sends the same token and gets the same
// registration back. Without JavaScript the field stays empty and a repeat is
// answered like any refusal, never with someone's invoice.
import { useEffect, useState } from "react";

export function SubmissionTokenField() {
  const [token, setToken] = useState("");
  useEffect(() => {
    const bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    setToken(btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
  }, []);
  return <input type="hidden" name="submissionToken" value={token} />;
}
