// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
import { SignOut } from "@phosphor-icons/react/dist/ssr";
import { signOutAction } from "../actions";

/** A form, not a link: signing out changes state, so it must not be a GET. */
export function SignOutButton({ label }: { label: string }) {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="inline-flex items-center gap-1.5 rounded-md border border-rule px-2.5 py-1.5 text-xs font-medium text-ink-muted"
      >
        <SignOut size={14} weight="bold" />
        {label}
      </button>
    </form>
  );
}
