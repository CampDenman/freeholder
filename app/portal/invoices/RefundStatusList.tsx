// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { z } from "zod";
import type { publicRefundState } from "@/modules/invoicing/merchant-refund-bank-state-service";
import { formatMoney, type Translate } from "@/core/i18n";

export function RefundStatusList({ refunds, t, locale }: {
  refunds: readonly z.infer<typeof publicRefundState>[]; t: Translate; locale: string;
}) {
  if (!refunds.length) return null;
  return <section className="grid gap-3" aria-label={t("refundStatus.title")}>
    <h2 className="font-semibold">{t("refundStatus.title")}</h2>
    <p className="text-sm text-ink-muted">{t("refundStatus.originalPayment")}</p>
    <ul className="grid list-none gap-3 p-0">
      {refunds.map(refund => <li key={refund.id} className="rounded border border-rule p-3">
        <p className="font-medium">{formatMoney(refund.amountMinor, refund.currency, locale)} · {t(`refundStatus.${refund.status}`)}</p>
        {refund.status === "requires_action" ? <p className="mt-1 text-sm">{t("refundStatus.actionHint")}</p> : null}
        {refund.refundPromiseOpen ? <p className="mt-1 text-sm text-ink-muted">{t("refundStatus.stillOwed")}</p> : null}
      </li>)}
    </ul>
  </section>;
}
