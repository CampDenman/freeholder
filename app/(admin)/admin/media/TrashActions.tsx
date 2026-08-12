// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useActionState, useState } from "react";
import { ArrowCounterClockwise, Trash, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Button, Callout, Field } from "@/ui/primitives";
import {
  purgeAssetAction,
  restoreAssetAction,
  type MediaActionState,
} from "../../media-actions";

export function TrashActions({
  id,
  filename,
  canPurge,
  needsStepUp,
  labels,
}: {
  id: string;
  filename: string;
  canPurge: boolean;
  needsStepUp: boolean;
  labels: {
    restore: string;
    purge: string;
    purgeHeading: string;
    purgeHint: string;
    confirmation: string;
    cancel: string;
    verify: string;
  };
}) {
  const [purging, setPurging] = useState(false);
  const [state, purgeAction, pending] = useActionState<MediaActionState, FormData>(
    purgeAssetAction,
    {},
  );
  return (
    <div className="grid gap-3">
      <form action={restoreAssetAction}>
        <input type="hidden" name="id" value={id} />
        <Button type="submit" variant="quiet">
          <ArrowCounterClockwise size={15} weight="bold" />
          {labels.restore}
        </Button>
      </form>
      {canPurge && needsStepUp ? (
        <a
          href="/security/verify?returnTo=/admin/media?view=trash"
          className="text-xs font-semibold text-accent underline underline-offset-2"
        >
          {labels.verify}
        </a>
      ) : null}
      {canPurge && !needsStepUp && !purging ? (
        <div>
          <Button type="button" variant="danger" onClick={() => setPurging(true)}>
            <Trash size={15} weight="bold" />
            {labels.purge}
          </Button>
        </div>
      ) : canPurge && !needsStepUp ? (
        <form
          action={purgeAction}
          className="grid gap-3 rounded-md border border-danger/30 bg-danger-soft p-3"
        >
          <input type="hidden" name="id" value={id} />
          {state.error ? (
            <Callout tone="danger" icon={<WarningCircle size={16} weight="fill" />}>
              {state.error}
            </Callout>
          ) : null}
          <p className="text-xs font-semibold text-danger">{labels.purgeHeading}</p>
          <Field
            label={labels.confirmation}
            htmlFor={`purge-${id}`}
            hint={labels.purgeHint.replace("{filename}", filename)}
          >
            <input
              id={`purge-${id}`}
              name="confirmation"
              required
              autoComplete="off"
              className="w-full rounded-md border border-rule bg-field px-3 py-2 font-mono text-sm text-ink"
            />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="danger" disabled={pending}>
              {labels.purge}
            </Button>
            <Button type="button" variant="quiet" onClick={() => setPurging(false)}>
              {labels.cancel}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
