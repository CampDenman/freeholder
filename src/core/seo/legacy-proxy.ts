// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// This leaf adapter asks the public service over the configured origin. No
// request cookies, forwarded headers or caller-supplied origin cross that seam.
import { siteOrigin } from "./origin";

const INTERNAL = /^\/(?:_next|admin|login|setup|preview|portal|api|media|embed|og|go|ap|feeds|\.well-known)(?:\/|$)/;
const FILE = /\.(?:css|js|map|json|xml|txt|ico|png|jpe?g|gif|svg|webp|avif|woff2?|mp[34]|pdf)$/i;
const PREFIX = /^\/([a-z]{2}(?:-[A-Za-z]{2,4})?)(\/.*)?$/;

export async function legacyRedirect(request: Request): Promise<Response | null> {
  if (!["GET", "HEAD"].includes(request.method)) return null;
  const requestUrl = new URL(request.url);
  const pathname = requestUrl.pathname;
  if (INTERNAL.test(pathname) || FILE.test(pathname)) return null;
  const prefix = PREFIX.exec(pathname);
  const locale = prefix?.[1] ?? "en";
  const localPath = prefix ? prefix[2] ?? "/" : pathname;
  if (INTERNAL.test(localPath)) return null;
  let path = localPath.replace(/^\/+|\/+$/g, "");
  try { path = decodeURIComponent(path); } catch { /* An invalid escape stays a structural miss. */ }
  const queryKeys = ["p", "page_id", "attachment_id", "feed"] as const;
  const query = queryKeys.find(key => requestUrl.searchParams.has(key));
  // ID query aliases belong to the site's root/index.php, never to arbitrary
  // paths. A tracking query on a page keeps that page's meaning.
  const candidate = query && ["", "index.php"].includes(path)
    ? `${path}?${query}=${requestUrl.searchParams.get(query)}` : path;
  try {
    const endpoint = new URL("/api/v1/seo.resolveRedirect", siteOrigin());
    endpoint.searchParams.set("path", candidate);
    endpoint.searchParams.set("locale", locale);
    const response = await fetch(endpoint, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(1500), headers: { accept: "application/json" } });
    if (response.ok) {
      const moved: unknown = await response.json();
      if (moved && typeof moved === "object" && "toPath" in moved && typeof moved.toPath === "string" && "status" in moved && ["301", "302"].includes(String(moved.status))) {
        const target = new URL(`/${prefix ? `${locale}/` : ""}${moved.toPath.replace(/^\/+/, "")}`, siteOrigin());
        if (target.origin === new URL(siteOrigin()).origin && target.href !== requestUrl.href) {
          return Response.redirect(target, Number(moved.status));
        }
      }
    }
  } catch {
    // A resolver outage never takes the page down. The route still resolves
    // content and its historical redirect fallback; acceptance checks must
    // detect a degraded redirect rather than declaring this path verified.
  }
  if (pathname.length > 1 && pathname.endsWith("/")) {
    const target = new URL(requestUrl.href);
    target.pathname = pathname.replace(/\/+$/, "");
    return Response.redirect(target, 301);
  }
  return null;
}
