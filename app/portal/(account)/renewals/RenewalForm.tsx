// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The one form behind both adding and correcting a tracked charge (C12.40).
//
// A server component with no client JavaScript: native controls, a native
// date picker, and a form that posts. The cycle/interval pair would be the
// usual reason to reach for a script — show the interval only for a custom
// cycle — and it is not worth it. The field carries its own hint, and the
// service refuses a custom cycle with no interval, so the rule is enforced
// where it has to be rather than hidden where it can be bypassed.
import { minorToDecimal } from "@/adapters/payments/currency";
import { Button, Callout, Field, Input, Select } from "@/ui/primitives";
import { RENEWAL_CYCLES } from "@/modules/renewal-alerts/service";
import { getT } from "../../../i18n";

export type TrackedForForm = {
  id: string;
  name: string;
  costMinor: number;
  currency: string;
  cycle: (typeof RENEWAL_CYCLES)[number];
  customIntervalDays: number | null;
  firstChargeAt: Date;
  alertDays: number;
  notes: string | null;
};

export async function RenewalForm({
  tracked,
  error,
  action,
}: {
  tracked?: TrackedForForm;
  error?: string;
  action: (form: FormData) => Promise<void>;
}) {
  const t = await getT();
  // Same string assembly the rest of the estate uses, so what is shown in the
  // box is exactly what `decimalToMinor` will read back (§15.4).
  const amount = tracked ? minorToDecimal(tracked.costMinor, tracked.currency) : "";
  const errorKey =
    error === "amount"
      ? "renewals.error.amount"
      : error === "date"
        ? "renewals.error.date"
        : error === "interval"
          ? "renewals.error.interval"
          : error
            ? "renewals.error.saving"
            : null;

  return (
    <form action={action} className="grid gap-4">
      {errorKey ? <Callout tone="danger">{t(errorKey)}</Callout> : null}
      {tracked ? <input type="hidden" name="id" value={tracked.id} /> : null}

      <Field label={t("renewals.form.name")} htmlFor="renewal-name">
        <Input
          id="renewal-name"
          name="name"
          required
          maxLength={120}
          defaultValue={tracked?.name ?? ""}
          autoComplete="off"
        />
      </Field>

      <Field label={t("renewals.form.amount")} htmlFor="renewal-amount">
        <Input
          id="renewal-amount"
          name="amount"
          required
          inputMode="decimal"
          // The shared parser accepts digits with an optional fractional part
          // and no grouping separators; the control refuses anything else
          // before a round trip rather than after one.
          pattern="[0-9]+([.][0-9]+)?"
          defaultValue={amount}
        />
      </Field>

      <Field label={t("renewals.form.currency")} htmlFor="renewal-currency">
        <Input
          id="renewal-currency"
          name="currency"
          required
          maxLength={3}
          minLength={3}
          pattern="[A-Za-z]{3}"
          defaultValue={tracked?.currency ?? "USD"}
          autoComplete="off"
        />
      </Field>

      <Field label={t("renewals.form.cycle")} htmlFor="renewal-cycle">
        <Select id="renewal-cycle" name="cycle" defaultValue={tracked?.cycle ?? "monthly"}>
          {RENEWAL_CYCLES.map((cycle) => (
            <option key={cycle} value={cycle}>
              {t(`renewals.cycle.${cycle}`)}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label={t("renewals.form.intervalDays")}
        htmlFor="renewal-interval"
        hint={t("renewals.form.intervalHint")}
      >
        <Input
          id="renewal-interval"
          name="customIntervalDays"
          type="number"
          min={1}
          max={3650}
          step={1}
          defaultValue={tracked?.customIntervalDays ?? ""}
        />
      </Field>

      <Field
        label={t("renewals.form.firstCharge")}
        htmlFor="renewal-first-charge"
        hint={t("renewals.form.firstChargeHint")}
      >
        <Input
          id="renewal-first-charge"
          name="firstChargeAt"
          type="date"
          required
          defaultValue={tracked ? tracked.firstChargeAt.toISOString().slice(0, 10) : ""}
        />
      </Field>

      <Field
        label={t("renewals.form.alertDays")}
        htmlFor="renewal-alert-days"
        hint={t("renewals.form.alertDaysHint")}
      >
        <Input
          id="renewal-alert-days"
          name="alertDays"
          type="number"
          min={0}
          max={90}
          step={1}
          defaultValue={tracked?.alertDays ?? 3}
        />
      </Field>

      <Field label={t("renewals.form.notes")} htmlFor="renewal-notes">
        {/* No Textarea primitive exists. `text-base` rather than the `text-sm`
            some older forms use, for the reason stated beside CONTROL in
            ui/primitives: iOS Safari zooms the page when a control under 16px
            takes focus. */}
        <textarea
          id="renewal-notes"
          name="notes"
          rows={3}
          maxLength={2000}
          defaultValue={tracked?.notes ?? ""}
          className="w-full rounded-md border border-rule-strong bg-field px-3 py-2 text-base text-ink"
        />
      </Field>

      <Button type="submit">{t("renewals.form.save")}</Button>
    </form>
  );
}
