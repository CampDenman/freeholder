// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import {
  ArrowClockwise,
  CheckCircle,
  Flask,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import { listDemoScenarios } from "@/core/demo/service";
import { onboardingTargets } from "@/core/onboarding/registry";
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Field,
  Pill,
  Select,
} from "@/ui/primitives";
import { getT } from "../../../i18n";
import { demoScenarioAction } from "../../demo-actions";
import { requireStaffActor } from "../guard";

export const dynamic = "force-dynamic";

const LOCALE_LABELS: Record<string, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
};

export default async function DemoScenariosPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; status?: string }>;
}) {
  const actor = await requireStaffActor("demo");
  const [query, scenarios, t] = await Promise.all([
    searchParams,
    listDemoScenarios.call({}, actor),
    getT(),
  ]);
  const targets = new Map(
    onboardingTargets().map((target) => [target.key, target.href]),
  );
  const statusKey = ["load", "reload", "reset", "purge"].includes(
    query.status ?? "",
  )
    ? `demo.status.${query.status}`
    : undefined;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("demo.title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          {t("demo.intro")}
        </p>
      </div>

      {query.error ? (
        <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
          {t("demo.actionError")}
        </Callout>
      ) : statusKey ? (
        <Callout tone="success" icon={<CheckCircle size={17} weight="fill" />}>
          {t(statusKey)}
        </Callout>
      ) : null}

      <Callout tone="accent" icon={<Flask size={17} weight="fill" />}>
        {t("demo.isolation")}
      </Callout>

      {scenarios.map((scenario) => {
        const fixtures = scenario.fixtureManifest;
        const active = scenario.activeRun;
        const localeId = `demo-locale-${scenario.key.replaceAll(".", "-")}`;
        return (
          <Card key={`${scenario.key}@${scenario.version}`}>
            <CardHeader
              icon={<Flask size={17} weight="bold" />}
              title={t(scenario.titleKey)}
              status={
                active ? (
                  <Pill tone="success">{t("demo.active")}</Pill>
                ) : (
                  <Pill>{t("demo.ready")}</Pill>
                )
              }
            />
            <CardBody>
              <div>
                <p className="text-sm text-ink-muted">
                  {t(scenario.descriptionKey)}
                </p>
                <p className="mt-2 font-mono text-xs text-ink-muted">
                  {scenario.key}@{scenario.version} / {scenario.preset}
                </p>
              </div>
              {active ? (
                <p className="text-sm">
                  {t("demo.activeRun", {
                    locale: LOCALE_LABELS[active.locale] ?? active.locale,
                    generation: active.generation,
                  })}
                </p>
              ) : null}
              <div>
                <h3 className="text-sm font-semibold">{t("demo.outcomes")}</h3>
                <ul className="mt-2 grid list-none gap-2 p-0">
                  {fixtures.flatMap((fixture) =>
                    fixture.expectedOutcomes.map((outcome) => (
                      <li key={`${fixture.key}:${outcome.key}`}>
                        <a
                          href={targets.get(outcome.targetKey) ?? "/admin/demos"}
                          className="inline-flex items-center gap-2 text-sm font-medium text-accent"
                        >
                          <CheckCircle size={15} weight="bold" />
                          {t(outcome.labelKey)}
                        </a>
                      </li>
                    )),
                  )}
                </ul>
              </div>
            </CardBody>
            <CardFooter>
              <form action={demoScenarioAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="key" value={scenario.key} />
                <Field label={t("demo.locale")} htmlFor={localeId}>
                  <Select
                    id={localeId}
                    name="locale"
                    defaultValue={active?.locale ?? scenario.defaultLocale}
                    className="min-w-40"
                  >
                    {scenario.supportedLocales.map((locale) => (
                      <option key={locale} value={locale}>
                        {LOCALE_LABELS[locale] ?? locale}
                      </option>
                    ))}
                  </Select>
                </Field>
                {active ? (
                  <>
                    <Button type="submit" name="intent" value="reload" variant="quiet">
                      <ArrowClockwise size={15} weight="bold" />
                      {t("demo.reload")}
                    </Button>
                    <Button type="submit" name="intent" value="reset">
                      {t("demo.reset")}
                    </Button>
                    <Button type="submit" name="intent" value="purge" variant="danger">
                      <Trash size={15} weight="bold" />
                      {t("demo.purge")}
                    </Button>
                  </>
                ) : (
                  <Button type="submit" name="intent" value="load">
                    {t("demo.load")}
                  </Button>
                )}
              </form>
            </CardFooter>
          </Card>
        );
      })}
    </div>
  );
}
