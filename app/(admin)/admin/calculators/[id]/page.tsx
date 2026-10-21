// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One calculator: what it asks, what it works out, and whether it is open.
import { notFound } from "next/navigation";
import { getCalculator } from "@/modules/calculators/service";
import { ServiceError, hasModuleAccess } from "@/core/service";
import { Pill } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { CalculatorBuilder } from "../CalculatorBuilder";
import { CalculatorPublish } from "../CalculatorPublish";
import { calculatorLabels } from "../labels";
import type { CalculatorInput, CalculatorStep } from "@/modules/calculators/formula";

export const dynamic = "force-dynamic";

export default async function CalculatorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireStaffActor("calculators");
  const found = await getCalculator.call({ id }, actor).catch((error: unknown) => {
    if (error instanceof ServiceError && error.code === "not_found") notFound();
    throw error;
  });
  const t = await getT();
  const canManage = hasModuleAccess(actor, "calculators", "manage");

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{found.name}</h1>
          <p className="mt-1 font-mono text-xs text-ink-muted">/{found.slug}</p>
        </div>
        <Pill
          tone={
            found.status === "active" ? "success" : found.status === "draft" ? "warning" : "neutral"
          }
        >
          {t(`calculators.status.${found.status}`)}
        </Pill>
      </div>

      {canManage ? (
        <CalculatorPublish
          id={found.id}
          status={found.status}
          labels={{
            publish: t("calculators.publish"),
            reopen: t("calculators.reopen"),
            close: t("calculators.close"),
          }}
        />
      ) : null}

      <CalculatorBuilder
        calculator={{
          id: found.id,
          slug: found.slug,
          name: found.name,
          intro: found.intro,
          inputs: found.inputs as CalculatorInput[],
          steps: found.steps as CalculatorStep[],
          resultLabel: found.resultLabel,
          resultUnit: found.resultUnit,
          assumptions: found.assumptions,
        }}
        labels={calculatorLabels(t, false)}
      />
    </div>
  );
}
