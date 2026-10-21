// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Starting a calculator (MASTER.md §4.18, C5.26).
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { CalculatorBuilder } from "../CalculatorBuilder";
import { calculatorLabels } from "../labels";

export const dynamic = "force-dynamic";

export default async function NewCalculatorPage() {
  await requireStaffActor("calculators", "manage");
  const t = await getT();
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("calculators.builder.newTitle")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("calculators.builder.newIntro")}</p>
      </div>
      <CalculatorBuilder
        calculator={{
          slug: "",
          name: "",
          intro: null,
          inputs: [],
          steps: [],
          resultLabel: "",
          resultUnit: null,
          assumptions: "",
        }}
        labels={calculatorLabels(t, true)}
      />
    </div>
  );
}
