// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.37: mail scanners may read a capability link; only a POST applies it.
import { currentDesign } from "@/core/design/read";
import { themeStylesheet } from "@/core/design/tokens";
import { parseThemePreference, themeAttribute, THEME_COOKIE } from "@/core/design/theme";
import { CSP_NONCE_HEADER } from "@/core/http/csp";
import { LOCALE_HEADER } from "@/core/http/headers";
import { availableLocales, localeDirection, t } from "@/core/i18n";

const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

export async function mailLinkConfirmation(request: Request, action: "confirm" | "unsubscribe"): Promise<Response> {
  const url = new URL(request.url);
  const requested = request.headers.get(LOCALE_HEADER) || url.searchParams.get("locale") || "en";
  let locale = "en";
  try {
    const parsed = new Intl.Locale(requested);
    if (availableLocales().includes(parsed.language)) locale = parsed.toString();
  } catch { /* An invalid query locale uses the default catalog. */ }
  const title = t(locale, action === "confirm" ? "newsletters.confirmTitle" : "newsletters.unsubscribeTitle");
  const description = t(locale, action === "confirm" ? "newsletters.confirmInstruction" : "newsletters.unsubscribeInstruction");
  const button = t(locale, action === "confirm" ? "newsletters.confirmAction" : "newsletters.unsubscribeLink");
  const cookie = request.headers.get("cookie")?.split(";").map(value => value.trim()).find(value => value.startsWith(`${THEME_COOKIE}=`))?.slice(THEME_COOKIE.length + 1);
  const theme = themeAttribute(parseThemePreference(cookie));
  const nonce = request.headers.get(CSP_NONCE_HEADER) ?? "";
  const design = await currentDesign();
  const html = `<!doctype html><html lang="${escape(locale)}" dir="${localeDirection(locale)}"${theme ? ` data-theme="${theme}"` : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escape(title)}</title><style nonce="${escape(nonce)}">${themeStylesheet(design.theme, design.extras)}
body{margin:0;background:var(--fh-paper);color:var(--fh-ink);font-family:var(--fh-font-sans,system-ui,sans-serif);line-height:1.6}main{max-width:36rem;margin:10vh auto;padding:2rem}button{font:inherit;background:var(--fh-accent);color:var(--fh-on-accent);padding:.75rem 1rem;border:0;border-radius:.375rem;cursor:pointer}button:focus-visible{outline:3px solid var(--fh-focus);outline-offset:3px}</style></head><body><main><h1>${escape(title)}</h1><p>${escape(description)}</p><form method="post" action="${escape(url.pathname + url.search)}"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit">${escape(button)}</button></form></main></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" } });
}
