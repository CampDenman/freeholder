// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useActionState } from "react";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Input,
} from "@/ui/primitives";
import { saveOpeningHoursAction, type ActionState } from "../../actions";

export interface HoursRow {
  weekday: number;
  /** Day name in the owner's own language — built server-side from Intl. */
  label: string;
  opens: string;
  closes: string;
  closed: boolean;
}

export interface HoursFormLabels {
  cardTitle: string;
  intro: string;
  opens: string;
  closes: string;
  closed: string;
  submit: string;
  pending: string;
  saved: string;
}

/**
 * A week of opening hours, edited as a week (§4.10).
 *
 * Seven rows always, whatever is filled in: an owner setting Saturday hours
 * should not have to first find an "add a day" control, and a day left blank
 * is a day nobody has said anything about — which the action drops rather than
 * sending as a half-filled entry.
 */
export function HoursForm({
  locationId,
  rows,
  labels,
}: {
  locationId: string;
  rows: HoursRow[];
  labels: HoursFormLabels;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    saveOpeningHoursAction,
    {},
  );

  return (
    <form action={action}>
      <Card>
        <CardHeader title={labels.cardTitle} />
        <CardBody>
          {state.error ? (
            <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
              {state.error}
            </Callout>
          ) : null}
          {state.saved ? (
            <Callout tone="success" icon={<CheckCircle size={17} weight="fill" />}>
              {labels.saved}
            </Callout>
          ) : null}
          <p className="max-w-prose text-sm text-ink-muted">{labels.intro}</p>

          <input type="hidden" name="locationId" value={locationId} />

          <div className="grid gap-3">
            {rows.map((row) => (
              <div
                key={row.weekday}
                className="grid items-center gap-3 sm:grid-cols-[8rem_1fr_1fr_auto]"
              >
                <span className="text-sm font-semibold text-ink">{row.label}</span>
                <label className="grid gap-1 text-xs text-ink-muted">
                  {labels.opens}
                  <Input
                    type="time"
                    name={`opens-${row.weekday}`}
                    defaultValue={row.opens}
                  />
                </label>
                <label className="grid gap-1 text-xs text-ink-muted">
                  {labels.closes}
                  <Input
                    type="time"
                    name={`closes-${row.weekday}`}
                    defaultValue={row.closes}
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-ink-muted">
                  <input
                    type="checkbox"
                    name={`closed-${row.weekday}`}
                    defaultChecked={row.closed}
                    className="size-4 accent-[var(--color-accent)]"
                  />
                  {labels.closed}
                </label>
              </div>
            ))}
          </div>
        </CardBody>
        <CardFooter>
          <Button type="submit" disabled={pending}>
            {pending ? labels.pending : labels.submit}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
