// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { FindMeStillPublicationStatus } from "@/core/findmestill/service";
import { Field, Input } from "@/ui/primitives";

export function DeskPublication({ status, shareUrl, label, staleText }: {
  status: FindMeStillPublicationStatus;
  shareUrl: string;
  label: string;
  staleText: string;
}) {
  if (status === "stale") return <p className="text-sm text-ink-muted">{staleText}</p>;
  if (status === "unpublished") return null;
  return (
    <Field htmlFor="fms-share" label={label}>
      <Input id="fms-share" dir="ltr" readOnly value={shareUrl} />
    </Field>
  );
}
