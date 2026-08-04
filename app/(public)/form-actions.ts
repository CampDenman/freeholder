// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
"use server";
// The public form's door into the service layer (MASTER.md §11, §36).
//
// A Server Action rather than a JSON endpoint, for the same reason the setup
// wizard uses one: the form works before any JavaScript has loaded. For a
// contact form that matters more than most — the moment somebody decides to
// get in touch is the worst possible moment to spend on a hydration wait.
// Next verifies the request Origin for actions, so this path carries its own
// CSRF defence.
//
// The result is carried back in the URL and rendered by the block, so the
// public surface stays plain server-rendered HTML with no client component and
// no hydration boundary — which is what §5 and the SEO gate both rest on.
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { submitForm } from "@/modules/forms/service";
import { PATH_HEADER } from "@/core/http/headers";

const ANONYMOUS = { kind: "anonymous" } as const;

/**
 * Only a code travels in the URL, never a message.
 *
 * A page that echoes arbitrary text from its own query string is a phishing
 * page waiting for a crafted link — "your payment failed, call this number" —
 * and no amount of escaping fixes that, because the text is not the attack.
 * Browsers enforce `required` and `type=email` natively, so the specific
 * validation messages are a backstop rather than the primary feedback.
 */
export async function submitPublicForm(form: FormData): Promise<void> {
  // FormData yields `string | File | null`, and a File would stringify to
  // "[object File]" — so the type is checked rather than coerced.
  const rawSlug = form.get("form_slug");
  const slug = typeof rawSlug === "string" ? rawSlug : "";
  const requestHeaders = await headers();
  const path = requestHeaders.get(PATH_HEADER) ?? "/";

  const values: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (key === "form_slug") continue;
    // A checkbox posts "on" when ticked and nothing at all when not, which is
    // not what a boolean field's validator expects.
    values[key] = value === "on" ? true : value;
  }

  try {
    await submitForm.call(
      { slug, values, sourceUrl: path },
      ANONYMOUS,
    );
  } catch {
    // Deliberately not distinguishing between validation, rate limiting and a
    // genuine fault in the redirect: a public form that reports *why* it
    // refused a submission is also telling a script how to get past it.
    // The owner sees the real reason in the audit log either way.
    redirect(`${path}?formError=${encodeURIComponent(slug)}`);
  }

  redirect(`${path}?sent=${encodeURIComponent(slug)}`);
}
