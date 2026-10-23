// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What the shopper hears after pressing "Add to cart" (C5.20).
//
// addToCartAction redirects back to the page the button was on with
// `?added=<product>` or `?cartError=add`. Nothing read those codes, so the
// only feedback was a changed URL (2026-10-23 demo audit). The public shell
// renders this from the request target, so it works on every shelf — product
// pages, collections, search, CMS blocks — without JavaScript. Success is a
// polite status message with the way to the cart; a failure is an alert.

import { Callout } from "@/ui/primitives";

export interface AddedNoticeLabels {
  added: string;
  viewCart: string;
  failed: string;
}

/** Which notice a request target asks for, if any. */
export function addedNoticeKind(target: string): "added" | "failed" | null {
  const query = target.indexOf("?");
  if (query < 0) return null;
  const params = new URLSearchParams(target.slice(query + 1));
  if (params.get("cartError") === "add") return "failed";
  return params.has("added") ? "added" : null;
}

export function AddedNotice({
  target,
  cartHref,
  labels,
}: {
  target: string;
  cartHref: string;
  labels: AddedNoticeLabels;
}) {
  const kind = addedNoticeKind(target);
  if (!kind) return null;
  if (kind === "failed") {
    return (
      // The danger Callout is itself the alert.
      <div className="mb-6">
        <Callout tone="danger">{labels.failed}</Callout>
      </div>
    );
  }
  return (
    <div role="status" aria-live="polite" className="mb-6" data-cart-added>
      <Callout tone="success">
        {labels.added}{" "}
        <a href={cartHref} className="font-semibold underline underline-offset-2">
          {labels.viewCart}
        </a>
      </Callout>
    </div>
  );
}
