// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A semantic, server-rendered task guide shared by staff and customer shells.
// It has no client-side completion toggle: the service decides completion from
// real product evidence when this surface renders again.
import {
  ArrowSquareOut,
  CheckCircle,
  Circle,
} from "@phosphor-icons/react/dist/ssr";
import type { Translate } from "@/core/i18n";
import type { GuidanceFlowView } from "@/core/guidance/service";
import { Button, Pill, cx } from "@/ui/primitives";

export type GuidanceFormAction = (form: FormData) => void | Promise<void>;

function statusLabel(flow: GuidanceFlowView, t: Translate): string {
  if (flow.state === "completed") return t("guidance.completed");
  if (flow.state === "dismissed") return t("guidance.dismissed");
  if (flow.state === "not_started") return t("guidance.notStarted");
  return t("guidance.progress");
}

function GuidanceAction({
  action,
  flowKey,
  intent,
  returnTo,
  label,
  variant = "quiet",
}: {
  action: GuidanceFormAction;
  flowKey: string;
  intent: "start" | "dismiss" | "reset";
  returnTo: string;
  label: string;
  variant?: "primary" | "quiet";
}) {
  return (
    <form action={action}>
      <input type="hidden" name="flowKey" value={flowKey} />
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <Button type="submit" variant={variant}>{label}</Button>
    </form>
  );
}

export function GuidancePanel({
  flows,
  action,
  returnTo,
  t,
  title,
  intro,
  id = "guidance",
}: {
  flows: GuidanceFlowView[];
  action: GuidanceFormAction;
  returnTo: string;
  t: Translate;
  title?: string;
  intro?: string;
  id?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-6">
      <div className="mb-4">
        <h2 id={`${id}-heading`} className="text-lg font-bold tracking-tight">
          {title ?? t("guidance.title")}
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          {intro ?? t("guidance.intro")}
        </p>
      </div>

      {flows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-rule bg-surface px-4 py-6 text-sm text-ink-muted">
          {t("guidance.empty")}
        </p>
      ) : (
        <div className="grid gap-5">
          {flows.map((flow) => {
            const currentKey = flow.steps.find((step) => !step.completed)?.key;
            const progressText = t("guidance.progressValue", {
              complete: flow.completedCount,
              total: flow.totalCount,
            });
            return (
              <article
                key={`${flow.key}@${flow.version}`}
                data-guidance-flow={flow.key}
                className="overflow-hidden rounded-lg border border-rule bg-surface"
              >
                <header className="flex flex-wrap items-start gap-3 border-b border-rule bg-surface-muted px-4 py-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-ink">{t(flow.titleKey)}</h3>
                    <p className="mt-1 max-w-2xl text-sm text-ink-muted">
                      {t(flow.descriptionKey)}
                    </p>
                  </div>
                  <Pill tone={flow.state === "completed" ? "success" : flow.state === "active" ? "accent" : "neutral"}>
                    {statusLabel(flow, t)}
                  </Pill>
                </header>

                <div className="grid gap-5 px-4 py-5">
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between gap-3 text-xs text-ink-muted">
                      <span>{t("guidance.progress")}</span>
                      <span>{progressText}</span>
                    </div>
                    <progress
                      value={flow.completedCount}
                      max={flow.totalCount}
                      aria-label={progressText}
                      className="h-2 w-full accent-accent"
                    >
                      {progressText}
                    </progress>
                  </div>

                  {flow.state === "completed" ? (
                    <p className="text-sm text-success">{t("guidance.doneHint")}</p>
                  ) : null}

                  <ol className="grid list-none gap-3 p-0">
                    {flow.steps.map((step) => {
                      const current = flow.state === "active" && step.key === currentKey;
                      return (
                        <li
                          key={step.key}
                          aria-current={current ? "step" : undefined}
                          className={cx(
                            "grid gap-3 rounded-md border p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start",
                            current ? "border-accent bg-accent-soft/30" : "border-rule",
                          )}
                        >
                          <span className={step.completed ? "text-success" : "text-ink-muted"}>
                            {step.completed ? (
                              <CheckCircle size={20} weight="fill" aria-hidden="true" />
                            ) : (
                              <Circle size={20} aria-hidden="true" />
                            )}
                            <span className="sr-only">
                              {step.completed ? t("guidance.completed") : t("guidance.notStarted")}
                            </span>
                          </span>
                          <div>
                            <h4 className="text-sm font-semibold">{t(step.titleKey)}</h4>
                            <p className="mt-1 text-sm text-ink-muted">
                              {t(step.descriptionKey)}
                            </p>
                          </div>
                          {flow.state === "active" || step.completed ? (
                            <a
                              href={step.href}
                              className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent underline-offset-2 hover:underline"
                            >
                              {t("guidance.openTask")}
                              <ArrowSquareOut size={15} aria-hidden="true" />
                            </a>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                </div>

                <footer className="flex flex-wrap gap-3 border-t border-rule bg-surface-muted px-4 py-3.5">
                  {flow.state === "not_started" ? (
                    <>
                      <GuidanceAction action={action} flowKey={flow.key} intent="start" returnTo={returnTo} label={t("guidance.start")} variant="primary" />
                      <GuidanceAction action={action} flowKey={flow.key} intent="dismiss" returnTo={returnTo} label={t("guidance.skip")} />
                    </>
                  ) : null}
                  {flow.state === "active" ? (
                    <>
                      <GuidanceAction action={action} flowKey={flow.key} intent="dismiss" returnTo={returnTo} label={t("guidance.skip")} />
                      <GuidanceAction action={action} flowKey={flow.key} intent="reset" returnTo={returnTo} label={t("guidance.reset")} />
                    </>
                  ) : null}
                  {flow.state === "dismissed" ? (
                    <>
                      <GuidanceAction action={action} flowKey={flow.key} intent="start" returnTo={returnTo} label={t("guidance.resume")} variant="primary" />
                      <GuidanceAction action={action} flowKey={flow.key} intent="reset" returnTo={returnTo} label={t("guidance.reset")} />
                    </>
                  ) : null}
                  {flow.state === "completed" ? (
                    <GuidanceAction action={action} flowKey={flow.key} intent="reset" returnTo={returnTo} label={t("guidance.reset")} />
                  ) : null}
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
