// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Visual design controls over semantic tokens (C2.15).
import { getDesign } from "@/core/design/service";
import { listAssets } from "@/core/media/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { DesignForm, ResetDesignButton } from "./DesignForm";

export const dynamic = "force-dynamic";

export default async function DesignPage() {
  const actor = await requireStaffActor("settings", "manage");
  const [design, library, t] = await Promise.all([
    getDesign.call({}, actor),
    listAssets.call({ kind: "image", limit: 50 }, actor),
    getT(),
  ]);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t("design.title")}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t("design.intro")}</p>
        </div>
        <ResetDesignButton label={t("design.reset")} />
      </div>
      <DesignForm
        values={{
          lightAccent: design.theme.light.accent,
          lightPaper: design.theme.light.paper,
          lightInk: design.theme.light.ink,
          darkAccent: design.theme.dark.accent,
          darkPaper: design.theme.dark.paper,
          darkInk: design.theme.dark.ink,
          fontSans: design.extras.fontSans ?? "",
          fontMono: design.extras.fontMono ?? "",
          radius: design.extras.radius ?? "",
          motion: design.extras.motion ?? "",
          measure: design.extras.measure ?? "",
          gutter: design.extras.gutter ?? "",
          logoAssetId: design.logoAssetId ?? "",
        }}
        logos={library.rows.map((row) => ({ id: row.id, filename: row.filename }))}
        labels={{
          title: t("design.layout"),
          intro: t("design.intro"),
          light: t("design.light"),
          dark: t("design.dark"),
          accent: t("design.accent"),
          paper: t("design.paper"),
          ink: t("design.ink"),
          fontSans: t("design.fontSans"),
          fontMono: t("design.fontMono"),
          radius: t("design.radius"),
          motion: t("design.motion"),
          measure: t("design.measure"),
          gutter: t("design.gutter"),
          logo: t("design.logo"),
          logoNone: t("design.logoNone"),
          submit: t("common.saveChanges"),
          pending: t("common.saving"),
          saved: t("design.saved"),
          reset: t("design.reset"),
          radiusDefault: t("design.radiusDefault"),
          motionDefault: t("design.motionDefault"),
          motionReduced: t("design.motionReduced"),
          measureNarrow: t("design.measureNarrow"),
          measureDefault: t("design.measureDefault"),
          measureWide: t("design.measureWide"),
        }}
      />
    </div>
  );
}
