// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Header names the platform sets on itself.
//
// A leaf module on purpose: `proxy.ts` runs in the Edge runtime, which cannot
// load the rest of core (see instrumentation.ts), so anything it shares with
// server components has to live somewhere that imports nothing.

/**
 * The request path, forwarded so server components can read it.
 *
 * A layout cannot ask which page is rendering inside it — that is deliberate
 * in the App Router. But §32 puts the site chrome in the layout, and a nav
 * cannot mark its current entry without knowing the current path. The proxy
 * sets this on every request and `app/(public)/layout.tsx` reads it, which
 * keeps the nav a server component rather than a client one that exists only
 * to call usePathname().
 */
export const PATH_HEADER = "x-freeholder-path";
