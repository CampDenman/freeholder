// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// Opening a calculator, and the refusal that stops it.
//
// "These figures have not been published yet, so the calculator has nothing to
// work from" has to appear beside the button that caused it. A calculator that
// goes live pointing at an unpublished rate is one that fails its first
// visitor, and the owner will not be watching when it does.
import { useActionState } from "react";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Button, Callout } from "@/ui/primitives";
import {
  closeCalculatorAction,
  publishCalculatorAction,
  type CalculatorActionState,
} from "../../calculators-actions";

export function CalculatorPublish({
  id,
  status,
  labels,
}: {
  id: string;
  status: "draft" | "active" | "closed";
  labels: { publish: string; reopen: string; close: string };
}) {
  const [publishState, publish, publishing] = useActionState<CalculatorActionState, FormData>(
    publishCalculatorAction,
    {},
  );
  const [closeState, close, closing] = useActionState<CalculatorActionState, FormData>(
    closeCalculatorAction,
    {},
  );
  return (
    <div className="grid gap-3">
      {status === "active" ? (
        <form action={close}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit" variant="quiet" disabled={closing}>
            {labels.close}
          </Button>
        </form>
      ) : (
        <form action={publish}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit" disabled={publishing}>
            {status === "closed" ? labels.reopen : labels.publish}
          </Button>
        </form>
      )}
      {publishState.error ? (
        <Callout tone="danger" icon={<WarningCircle size={16} weight="bold" />}>
          {publishState.error}
        </Callout>
      ) : null}
      {closeState.error ? (
        <Callout tone="danger" icon={<WarningCircle size={16} weight="bold" />}>
          {closeState.error}
        </Callout>
      ) : null}
    </div>
  );
}
