// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Telling a person from a program (MASTER.md §4.7, §36).
//
// ── Why this is more than a regex ─────────────────────────────────────────
//
// The first version of this was one hand-written pattern list, and hand-written
// pattern lists are wrong in both directions from the day they are written:
// they miss the crawler that launched last month, and they catch the person
// whose browser happens to contain a matching substring. Traffic numbers built
// on that are wrong in a way nobody can see, which is the worst kind.
//
// So two things changed. The list is `isbot` — maintained, public domain, and
// updated as crawlers appear — rather than ours. And it is one signal among
// several, because the interesting bots are precisely the ones that do not say
// so: a scraper sending a copied Chrome user-agent passes any list and fails
// on the shape of its headers.
//
// ── What is deliberately not here ─────────────────────────────────────────
//
// **Reverse-DNS verification** of declared crawlers (the correct way to know a
// self-declared Googlebot really is one) is a DNS round trip per request. It
// belongs behind a cache and a job, not in a page render.
//
// **IP reputation and datacentre ranges** would be the strongest signal
// available. §4.7 stores no IP address on purpose, and adding one to catch
// bots would mean building the surveillance §36 rules out in order to measure
// the traffic — a bad trade at any accuracy.
//
// **A JavaScript challenge** would catch headless browsers, and would also
// stop counting every visitor with JavaScript off, which is the population
// most likely to be excluded by everything else too.
import { isbot } from "isbot";

/** What we think this request was. */
export type VisitorKind = "human" | "bot" | "suspected";

export interface Classification {
  kind: VisitorKind;
  /** Why, in words an owner reading their own traffic can weigh. */
  reasons: string[];
}

/** The headers a classification reads. Nothing here is stored. */
export interface RequestShape {
  userAgent: string | null;
  accept: string | null;
  acceptLanguage: string | null;
  secFetchMode: string | null;
  secFetchDest: string | null;
  secFetchSite: string | null;
  /** Chromium's client hints. Absent on Firefox and Safari, so weak alone. */
  secChUa: string | null;
}

/**
 * Classify one request.
 *
 * Three outcomes rather than two. "Suspected" exists because the honest answer
 * to a request with a plausible user-agent and no browser headers is *probably
 * not a person, but I would not delete their visit over it* — and an owner who
 * wants to decide for themselves needs the platform to have kept the
 * distinction rather than flattened it.
 */
export function classify(request: RequestShape): Classification {
  const reasons: string[] = [];

  if (!request.userAgent) {
    // Every real browser sends one. Something that does not is a script.
    return { kind: "bot", reasons: ["sent no user-agent"] };
  }

  if (isbot(request.userAgent)) {
    return { kind: "bot", reasons: ["identified itself as a crawler or tool"] };
  }

  // A browser asking for a page sends a long Accept beginning with text/html.
  // `*/*` is what a library sends when it does not care.
  const accept = request.accept ?? "";
  if (!accept) {
    reasons.push("sent no Accept header");
  } else if (!accept.includes("text/html") && !accept.includes("*/*")) {
    reasons.push("did not ask for a web page");
  } else if (accept.trim() === "*/*") {
    reasons.push("asked for anything rather than a page");
  }

  if (!request.acceptLanguage) {
    // Browsers send this because people have languages. Scripts rarely bother.
    reasons.push("expressed no language preference");
  }

  // Fetch metadata. Every browser released since 2019 sends these on a
  // navigation; nothing else does. Absence is the strongest signal available
  // without touching the network or the visitor's device — but it is not
  // conclusive on its own, because somebody may be on a genuinely old browser.
  const hasFetchMetadata = Boolean(
    request.secFetchMode ?? request.secFetchDest ?? request.secFetchSite,
  );
  if (!hasFetchMetadata) {
    reasons.push("sent none of the headers a browser sends when navigating");
  } else if (request.secFetchDest && request.secFetchDest !== "document") {
    // A page view means a document. `empty` is a fetch() — a script reading
    // the page, or our own code, but not somebody looking at it.
    reasons.push(`asked for a ${request.secFetchDest}, not a page`);
  }

  // Two or more independent signals is a program. One is somebody's unusual
  // browser, and calling that a bot is how a real visitor stops being counted.
  if (reasons.length >= 2) return { kind: "bot", reasons };
  if (reasons.length === 1) return { kind: "suspected", reasons };
  return { kind: "human", reasons: [] };
}

/** Read the shape from anything header-like. */
export function shapeOf(headers: {
  get(name: string): string | null;
}): RequestShape {
  return {
    userAgent: headers.get("user-agent"),
    accept: headers.get("accept"),
    acceptLanguage: headers.get("accept-language"),
    secFetchMode: headers.get("sec-fetch-mode"),
    secFetchDest: headers.get("sec-fetch-dest"),
    secFetchSite: headers.get("sec-fetch-site"),
    secChUa: headers.get("sec-ch-ua"),
  };
}
