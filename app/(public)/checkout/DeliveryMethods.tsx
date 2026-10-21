// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// The delivery-method picker's live half (C3.25 slice 3).
//
// Without JavaScript this renders a note and the form simply omits
// shippingMethodId, which catalog.checkoutCart resolves to the first eligible
// quote for the submitted address. With JavaScript, the address fields are
// watched and catalog.quoteShipping's eligible methods are offered as radios
// — the same service the server re-runs authoritatively, so the preview can
// never disagree with the charge.

import { useEffect, useRef, useState } from "react";
import { quoteDeliveryAction, type DeliveryQuotes } from "./checkout-actions";

export interface DeliveryMethodsLabels {
  legend: string;
  note: string;
  anyMethod: string;
  noShipping: string;
  noneReach: string;
  working: string;
}

const ADDRESS_IDS = ["checkout-country", "checkout-region", "checkout-postal"];

export function DeliveryMethods({ labels }: { labels: DeliveryMethodsLabels }) {
  const rootRef = useRef<HTMLFieldSetElement>(null);
  const [quotes, setQuotes] = useState<DeliveryQuotes | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const root = rootRef.current;
    const form = root?.closest("form");
    if (!root || !form) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const valueOf = (id: string) =>
      form.querySelector<HTMLInputElement>(`#${id}`)?.value?.trim() ?? "";
    const refresh = () => {
      const country = valueOf("checkout-country");
      if (!country || country.length !== 2) {
        setQuotes(null);
        return;
      }
      const run = ++seq.current;
      setBusy(true);
      void quoteDeliveryAction({
        country,
        region: valueOf("checkout-region") || undefined,
        postal: valueOf("checkout-postal") || undefined,
      })
        .then((result) => {
          if (seq.current === run) setQuotes(result);
        })
        .catch(() => undefined)
        .finally(() => {
          if (seq.current === run) setBusy(false);
        });
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 250);
    };
    for (const id of ADDRESS_IDS) {
      form.querySelector(`#${id}`)?.addEventListener("change", schedule);
    }
    refresh();
    return () => {
      clearTimeout(timer);
      for (const id of ADDRESS_IDS) {
        form.querySelector(`#${id}`)?.removeEventListener("change", schedule);
      }
    };
  }, []);

  return (
    <fieldset ref={rootRef} className="grid gap-2" data-delivery-methods>
      <legend className="text-sm font-semibold text-ink">{labels.legend}</legend>
      {quotes === null ? (
        <p className="text-sm text-ink-muted">{busy ? labels.working : labels.note}</p>
      ) : !quotes.needed ? (
        <p className="text-sm text-ink-muted">{labels.noShipping}</p>
      ) : quotes.quotes.length === 0 ? (
        <p className="text-sm text-danger">{labels.noneReach}</p>
      ) : (
        <div className="grid gap-2" role="radiogroup">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="radio" name="shippingMethodId" value="" defaultChecked />
            {labels.anyMethod}
          </label>
          {quotes.quotes.map((quote) => (
            <label key={quote.methodId} className="flex items-center gap-2 text-sm text-ink">
              <input type="radio" name="shippingMethodId" value={quote.methodId} />
              {quote.name}
              <span className="text-ink-muted">
                {(quote.amountMinor / 100).toLocaleString(undefined, {
                  style: "currency",
                  currency: quote.currency,
                })}
              </span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
