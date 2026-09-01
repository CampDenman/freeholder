// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Where a popup joins the page (MASTER.md §32, §36, C9.30).
//
// The public shell calls this once. It is a server component, so the popup's
// body is the same `renderBlocks` output a page gets — the same registry, the
// same resolvers, the same semantic HTML — and the only client code involved
// is the small component that decides when to open it and how to close it.
//
// Nothing renders when no popup is due, which is the ordinary case: an
// instance with no popups configured ships exactly the markup it shipped
// before this module existed.
import type { BlockNode } from "@/modules/cms/blocks/types";
import { renderBlocks } from "@/modules/cms/render";
import type { Translate } from "@/core/i18n";
import { decidePopup } from "./service";
import { PopupSurface } from "./PopupSurface";

const ANONYMOUS = { kind: "anonymous" } as const;

export interface PopupMountProps {
  path: string;
  locale: string;
  t: Translate;
  business: {
    name: string;
    tagline: string | null;
    defaultLocale?: string;
    enabledLocales?: string[];
  } | null;
  localizeHref?: (href: string) => string;
  /** The first-party visitor id, when analytics identifiers are permitted. */
  visitorKey: string | null;
  /** The raw cap cookie, decoded by the service rather than by the caller. */
  tally: string | null;
}

export async function PopupMount(props: PopupMountProps) {
  const popup = await decidePopup
    .call(
      {
        path: props.path,
        locale: props.locale,
        visitorKey: props.visitorKey,
        tally: props.tally,
      },
      ANONYMOUS,
    )
    // A popup is the least important thing on the page. If deciding one fails
    // — a module half-migrated, a segment that no longer compiles — the page
    // still renders. This is the one place in the module where swallowing is
    // the right answer, because the alternative is a 500 on somebody's home
    // page over an announcement.
    .catch(() => null);
  if (!popup) return null;

  const body = await renderBlocks(popup.blocks as BlockNode[], {
    locale: props.locale,
    t: props.t,
    business: props.business,
    path: props.path,
    localizeHref: props.localizeHref,
  });

  return (
    <PopupSurface
      id={popup.id}
      slug={popup.slug}
      title={popup.title}
      surface={popup.surface}
      trigger={popup.trigger}
      triggerValue={popup.triggerValue}
      captureMode={popup.captureMode}
      consentStatement={popup.consentStatement}
      path={props.path}
      labels={{
        dismiss: props.t("popups.public.dismiss"),
        email: props.t("popups.public.email"),
        join: props.t("popups.public.join"),
        sending: props.t("popups.public.sending"),
        failed: props.t("popups.public.failed"),
      }}
    >
      {body}
    </PopupSurface>
  );
}
