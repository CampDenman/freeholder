// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { listGuidance } from "@/core/guidance/service";
import { GuidancePanel } from "@/ui/GuidancePanel";
import { getT } from "../../../i18n";
import { adminGuidanceAction } from "../../guidance-actions";
import { requireStaffActor } from "../guard";

export const dynamic = "force-dynamic";

export default async function AdminGuidancePage({
  searchParams,
}: {
  searchParams: Promise<{ flow?: string; error?: string }>;
}) {
  const actor = await requireStaffActor();
  const [query, flows, t] = await Promise.all([
    searchParams,
    listGuidance.call({}, actor),
    getT(),
  ]);
  const ordered = query.flow
    ? [...flows].sort((left, right) =>
        Number(right.key === query.flow) - Number(left.key === query.flow),
      )
    : flows;
  const returnTo = query.flow
    ? `/admin/guidance?flow=${encodeURIComponent(query.flow)}#guidance`
    : "/admin/guidance#guidance";

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">
          {t("guidance.allTitle")}
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          {t("guidance.intro")}
        </p>
      </div>
      <GuidancePanel
        flows={ordered}
        action={adminGuidanceAction}
        returnTo={returnTo}
        t={t}
        title={t("guidance.title")}
        intro={t("guidance.intro")}
      />
    </div>
  );
}
