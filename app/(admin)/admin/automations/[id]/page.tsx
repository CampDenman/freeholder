// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The automation editor (C9.01, MASTER.md §4.17).
//
// **A list, not a canvas, and that is a decision.** §43 asks for a "visual"
// builder and the segment builder already argued the same case: "three rows of
// plain selects and one text box ... works with no JavaScript, which a
// drag-and-drop query builder does not." A step list with a `next` select on
// every row expresses exactly the same graph, is keyboard- and
// screen-reader-correct for free, and works on a phone in a van. What is lost
// is a picture; a picture can be layered on later without changing anything
// underneath.
//
// The screen's real job is the panel that says what is wrong. §4.17 refuses to
// publish a graph that does not hold up, so an owner must be able to see the
// refusal *before* they press the button, attached to the step that caused it
// rather than as one sentence at the top.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Field,
  Input,
  Pill,
  Select,
} from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import {
  getAutomation,
  triggers,
  verbs,
  versions,
} from "@/modules/automations/service";
import { listSegments } from "@/core/segments/service";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { domainOrNull } from "../../../read-helpers";
import {
  addStepAction,
  publishAction,
  removeStepAction,
  restoreVersionAction,
  saveSettingsAction,
  setEntryAction,
  setStatusAction,
  updateStepAction,
} from "../../../automation-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

interface Node {
  id: string;
  kind: string;
  next?: string | null;
  label?: string;
  verb?: string;
  params?: Record<string, unknown>;
  brief?: string;
  outputKey?: string;
  minutes?: number;
  body?: string;
  maxIterations?: number;
  reason?: string;
}

const STEP_KINDS = ["call", "prompt", "playbook", "wait", "branch", "loop", "gate", "stop"];

/**
 * The single parameter a call step carries, as text.
 *
 * Only a string is shown. A saved graph can hold anything, and rendering an
 * object into a text box as "[object Object]" would invite an owner to save it
 * back as that literal string.
 */
function paramValue(params: Record<string, unknown> | undefined): string {
  const first = Object.values(params ?? {})[0];
  return typeof first === "string" ? first : "";
}

export default async function AutomationEditor({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("automations", "manage");
  const { id } = await params;
  const query = await searchParams;

  const detail = await domainOrNull(getAutomation.call({ automationId: id }, actor));
  if (!detail) notFound();

  const [t, business, palette, available, history, audiences] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(verbs.call({}, actor)),
    domainOrNull(triggers.call({}, actor)),
    domainOrNull(versions.call({ automationId: id }, actor)),
    // The audiences the business has already defined (§30). Offering the list
    // rather than a rule builder is the point of C7.17.
    domainOrNull(listSegments.call({}, actor)),
  ]);

  const locale = business?.defaultLocale ?? "en";
  const when = (value: Date | string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(value),
    );

  const rule = detail.automation;
  const draft = (detail.draftGraph ?? { entry: "", nodes: [] }) as { entry: string; nodes: Node[] };
  const nodes = Array.isArray(draft.nodes) ? draft.nodes : [];
  const problemsByStep = new Map<string, string[]>();
  for (const problem of detail.problems) {
    const key = problem.nodeId ?? "";
    problemsByStep.set(key, [...(problemsByStep.get(key) ?? []), problem.message]);
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/automations" className="text-sm underline">
          {t("automations.back")}
        </Link>
        <h1 className="text-xl font-bold tracking-tight">{rule.name}</h1>
        <Pill tone={rule.status === "active" ? "success" : "neutral"}>
          {t(`automations.status.${rule.status}`)}
        </Pill>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("automations.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error}
        </p>
      ) : null}

      {/* What stops this being switched on, before the button is pressed. */}
      {detail.problems.length > 0 ? (
        <Callout tone="warning">
          <p className="font-medium">{t("automations.problems.title")}</p>
          <ul className="mt-1 grid list-disc gap-1 ps-5 text-sm">
            {detail.problems.map((problem, index) => (
              <li key={`${problem.nodeId ?? "graph"}-${index}`}>
                {problem.nodeId ? <code>{problem.nodeId}</code> : null} {problem.message}
              </li>
            ))}
          </ul>
        </Callout>
      ) : nodes.length > 0 ? (
        <Callout tone="success">{t("automations.problems.none")}</Callout>
      ) : null}

      <Card>
        <CardHeader title={t("automations.steps")} />
        <CardBody>
          {nodes.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("automations.noSteps")}</p>
          ) : (
            <ul className="grid list-none gap-3 p-0">
              {nodes.map((node) => {
                const problems = problemsByStep.get(node.id) ?? [];
                return (
                  <li
                    key={node.id}
                    className={
                      problems.length > 0
                        ? "grid gap-2 rounded-md border border-danger p-3"
                        : "grid gap-2 rounded-md border border-rule p-3"
                    }
                  >
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <code className="font-mono text-xs">{node.id}</code>
                      <Pill tone="accent">{t(`automations.kind.${node.kind}`)}</Pill>
                      {draft.entry === node.id ? (
                        <Pill tone="success">{t("automations.first")}</Pill>
                      ) : (
                        <form action={setEntryAction}>
                          <input type="hidden" name="automationId" value={rule.id} />
                          <input type="hidden" name="entry" value={node.id} />
                          <Button type="submit" variant="quiet">
                            {t("automations.action.makeFirst")}
                          </Button>
                        </form>
                      )}
                      <form action={removeStepAction} className="ms-auto">
                        <input type="hidden" name="automationId" value={rule.id} />
                        <input type="hidden" name="stepId" value={node.id} />
                        <Button type="submit" variant="quiet">
                          {t("automations.action.removeStep")}
                        </Button>
                      </form>
                    </div>

                    {problems.map((message, index) => (
                      <p key={index} className="text-sm font-medium text-danger">
                        {message}
                      </p>
                    ))}

                    <form action={updateStepAction} className="grid gap-3 md:grid-cols-3">
                      <input type="hidden" name="automationId" value={rule.id} />
                      <input type="hidden" name="stepId" value={node.id} />

                      <Field label={t("automations.field.label")} htmlFor={`label-${node.id}`}>
                        <Input
                          id={`label-${node.id}`}
                          name="label"
                          defaultValue={node.label ?? ""}
                          maxLength={120}
                        />
                      </Field>

                      {node.kind === "call" ? (
                        <>
                          <Field label={t("automations.field.verb")} htmlFor={`verb-${node.id}`}>
                            <Select id={`verb-${node.id}`} name="verb" defaultValue={node.verb ?? ""}>
                              <option value="">—</option>
                              {(palette ?? []).map((verb) => (
                                <option key={verb.key} value={verb.key}>
                                  {verb.label}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <div className="grid grid-cols-2 gap-2">
                            <Field
                              label={t("automations.field.paramKey")}
                              htmlFor={`pk-${node.id}`}
                            >
                              <Input
                                id={`pk-${node.id}`}
                                name="paramKey"
                                defaultValue={Object.keys(node.params ?? {})[0] ?? ""}
                              />
                            </Field>
                            <Field
                              label={t("automations.field.paramValue")}
                              htmlFor={`pv-${node.id}`}
                            >
                              <Input
                                id={`pv-${node.id}`}
                                name="paramValue"
                                defaultValue={paramValue(node.params)}
                              />
                            </Field>
                          </div>
                        </>
                      ) : null}

                      {node.kind === "prompt" ? (
                        <>
                          <Field label={t("automations.field.brief")} htmlFor={`brief-${node.id}`}>
                            <Input
                              id={`brief-${node.id}`}
                              name="brief"
                              defaultValue={node.brief ?? ""}
                              maxLength={8000}
                            />
                          </Field>
                          <Field
                            label={t("automations.field.outputKey")}
                            htmlFor={`out-${node.id}`}
                            hint={t("automations.field.outputHint")}
                          >
                            <Input
                              id={`out-${node.id}`}
                              name="outputKey"
                              defaultValue={node.outputKey ?? ""}
                            />
                          </Field>
                        </>
                      ) : null}

                      {node.kind === "wait" ? (
                        <Field label={t("automations.field.minutes")} htmlFor={`min-${node.id}`}>
                          <Input
                            id={`min-${node.id}`}
                            name="minutes"
                            type="number"
                            min={1}
                            defaultValue={node.minutes ?? 60}
                          />
                        </Field>
                      ) : null}

                      {node.kind === "loop" ? (
                        <>
                          <Field label={t("automations.field.body")} htmlFor={`body-${node.id}`}>
                            <Select id={`body-${node.id}`} name="body" defaultValue={node.body ?? ""}>
                              <option value="">—</option>
                              {nodes
                                .filter((each) => each.id !== node.id)
                                .map((each) => (
                                  <option key={each.id} value={each.id}>
                                    {each.id}
                                  </option>
                                ))}
                            </Select>
                          </Field>
                          <Field
                            label={t("automations.field.maxIterations")}
                            htmlFor={`iter-${node.id}`}
                            hint={t("automations.field.maxIterationsHint")}
                          >
                            <Input
                              id={`iter-${node.id}`}
                              name="maxIterations"
                              type="number"
                              min={1}
                              max={100}
                              defaultValue={node.maxIterations ?? 5}
                            />
                          </Field>
                        </>
                      ) : null}

                      {node.kind === "gate" || node.kind === "stop" ? (
                        <Field label={t("automations.field.reason")} htmlFor={`why-${node.id}`}>
                          <Input
                            id={`why-${node.id}`}
                            name="reason"
                            defaultValue={node.reason ?? ""}
                            maxLength={300}
                          />
                        </Field>
                      ) : null}

                      <Field
                        label={t("automations.field.next")}
                        htmlFor={`next-${node.id}`}
                        hint={t("automations.field.nextHint")}
                      >
                        <Select
                          id={`next-${node.id}`}
                          name="next"
                          defaultValue={node.next ?? ""}
                        >
                          <option value="">{t("automations.end")}</option>
                          {nodes
                            .filter((each) => each.id !== node.id)
                            .map((each) => (
                              <option key={each.id} value={each.id}>
                                {each.id}
                              </option>
                            ))}
                        </Select>
                      </Field>

                      <div className="flex items-end">
                        <Button type="submit" variant="quiet">
                          {t("automations.action.saveStep")}
                        </Button>
                      </div>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
        <CardFooter>
          <form action={addStepAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="automationId" value={rule.id} />
            <Field label={t("automations.field.addStep")} htmlFor="kind">
              <Select id="kind" name="kind" defaultValue="call">
                {STEP_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`automations.kind.${kind}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit">{t("automations.action.addStep")}</Button>
          </form>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader title={t("automations.settings")} />
        <CardBody>
          <form action={saveSettingsAction} className="grid gap-3 md:grid-cols-3">
            <input type="hidden" name="automationId" value={rule.id} />
            <Field label={t("automations.field.name")} htmlFor="name">
              <Input id="name" name="name" defaultValue={rule.name} required maxLength={120} />
            </Field>
            <Field label={t("automations.field.trigger")} htmlFor="triggerKind">
              <Select id="triggerKind" name="triggerKind" defaultValue={rule.triggerKind}>
                <option value="event">{t("automations.trigger.event")}</option>
                <option value="schedule">{t("automations.trigger.schedule")}</option>
                <option value="manual">{t("automations.trigger.manual")}</option>
              </Select>
            </Field>
            <Field label={t("automations.field.event")} htmlFor="eventPattern">
              <Select
                id="eventPattern"
                name="eventPattern"
                defaultValue={rule.eventPattern ?? ""}
              >
                <option value="">—</option>
                {(available ?? []).map((event) => (
                  <option key={event.name} value={event.name}>
                    {event.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("automations.field.schedule")} htmlFor="scheduleCron">
              <Input
                id="scheduleCron"
                name="scheduleCron"
                defaultValue={rule.scheduleCron ?? ""}
                placeholder="0 9 * * *"
              />
            </Field>
            {/* The audience (§30, C7.17). A segment rather than a filter of
                this screen's own: "who" is a question the business answers
                once, and an automation that answered it again could disagree
                with the campaign built on the same words. */}
            <Field
              label={t("automations.field.audience")}
              htmlFor="entrySegmentId"
              hint={t("automations.field.audienceHint")}
            >
              <Select
                id="entrySegmentId"
                name="entrySegmentId"
                defaultValue={rule.entrySegmentId ?? ""}
              >
                <option value="">{t("automations.field.everyone")}</option>
                {(audiences ?? []).map((segment) => (
                  <option key={segment.id} value={segment.id}>
                    {segment.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t("automations.field.reentry")}
              htmlFor="reentry"
              hint={t("automations.field.reentryHint")}
            >
              <Select id="reentry" name="reentry" defaultValue={rule.reentry}>
                <option value="once">{t("automations.reentry.once")}</option>
                <option value="cooldown">{t("automations.reentry.cooldown")}</option>
                <option value="always">{t("automations.reentry.always")}</option>
              </Select>
            </Field>
            <Field label={t("automations.field.cooldownDays")} htmlFor="cooldownDays">
              <Input
                id="cooldownDays"
                name="cooldownDays"
                type="number"
                min={1}
                defaultValue={rule.cooldownDays ?? ""}
              />
            </Field>
            <Field
              label={t("automations.field.autonomy")}
              htmlFor="autonomyCeiling"
              hint={t("automations.field.autonomyHint")}
            >
              <Select
                id="autonomyCeiling"
                name="autonomyCeiling"
                defaultValue={rule.autonomyCeiling ?? ""}
              >
                <option value="">—</option>
                <option value="suggest">{t("automations.autonomy.suggest")}</option>
                <option value="approve">{t("automations.autonomy.approve")}</option>
                <option value="autonomous">{t("automations.autonomy.autonomous")}</option>
              </Select>
            </Field>
            <Field label={t("automations.field.description")} htmlFor="description">
              <Input id="description" name="description" defaultValue={rule.description} />
            </Field>
            <div className="flex items-end">
              <Button type="submit">{t("automations.action.saveSettings")}</Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("automations.publishTitle")} />
        <CardBody>
          <p className="max-w-prose text-sm text-ink-muted">{t("automations.publishIntro")}</p>
          <form action={publishAction} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="automationId" value={rule.id} />
            <Field label={t("automations.field.note")} htmlFor="note">
              <Input id="note" name="note" maxLength={2000} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="activate" value="1" />
              {t("automations.activateNow")}
            </label>
            <Button type="submit">{t("automations.action.publish")}</Button>
          </form>

          <div className="mt-4 flex flex-wrap gap-2">
            {(["active", "paused", "archived"] as const).map((status) => (
              <form key={status} action={setStatusAction}>
                <input type="hidden" name="automationId" value={rule.id} />
                <input type="hidden" name="status" value={status} />
                <Button type="submit" variant="quiet" disabled={rule.status === status}>
                  {t(`automations.action.${status}`)}
                </Button>
              </form>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("automations.history")} />
        <CardBody>
          {history === null || history.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("automations.noVersions")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {history.map((version) => (
                <li
                  key={version.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                >
                  <span className="font-medium tabular-nums">v{version.version}</span>
                  {rule.currentVersionId === version.id ? (
                    <Pill tone="success">{t("automations.live")}</Pill>
                  ) : null}
                  <span className="text-ink-muted">{version.note ?? "—"}</span>
                  <span className="text-ink-muted">{when(version.createdAt)}</span>
                  {/* Restoring fills the draft; it never rewrites a version.
                      That is the property the history exists for. */}
                  <form action={restoreVersionAction} className="ms-auto">
                    <input type="hidden" name="automationId" value={rule.id} />
                    <input type="hidden" name="versionId" value={version.id} />
                    <Button type="submit" variant="quiet">
                      {t("automations.action.restore")}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
