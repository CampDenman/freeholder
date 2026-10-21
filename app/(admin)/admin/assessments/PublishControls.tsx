// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// Opening an assessment to visitors, and the refusal that stops it.
//
// The refusal is the reason this is a client component rather than a plain
// form post: "these questions can produce scores no band covers (4 to 7)" is
// the single most useful sentence in this screen, and it has to appear beside
// the button that caused it rather than as a page-level flash an owner scrolls
// past.
import { useActionState } from "react";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Button, Callout } from "@/ui/primitives";
import {
  closeAssessmentAction,
  publishAssessmentAction,
  type AssessmentActionState,
} from "../../assessments-actions";

export interface PublishLabels {
  publish: string;
  reopen: string;
  close: string;
}

export function PublishControls({
  id,
  status,
  labels,
}: {
  id: string;
  status: "draft" | "active" | "closed";
  labels: PublishLabels;
}) {
  const [publishState, publish, publishing] = useActionState<AssessmentActionState, FormData>(
    publishAssessmentAction,
    {},
  );
  const [closeState, close, closing] = useActionState<AssessmentActionState, FormData>(
    closeAssessmentAction,
    {},
  );

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
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
      </div>

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
