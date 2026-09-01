// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One popup: what it says, where it appears, who sees it, and how often
// (C9.30, MASTER.md §36).
//
// The four questions are four cards in the order an owner asks them. Compose
// first, because a popup with no words is not yet a decision; then where and
// to whom; then the cap, which is the promise the platform makes to the
// visitor on the owner's behalf; then how it has done.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Pill,
  Select,
} from "@/ui/primitives";
import { hasModuleAccess } from "@/core/service";
import { listAssets } from "@/core/media/service";
import { listSegments } from "@/core/segments/service";
import { listNewsletters } from "@/modules/newsletters/service";
import { getPopup, popupPerformance } from "@/modules/popups/service";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { domainOrNull } from "../../../read-helpers";
import { editorBlockTypes, editorLabels } from "../../editorLabels";
import { savePopupAction, setPopupStatusAction } from "../../../popup-actions";
import { PopupEditor } from "./PopupEditor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const CONTROL =
  "w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus-visible:border-accent";

function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asDateInput(value: Date | null): string {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

export default async function PopupDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("popups");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const popup = await domainOrNull(getPopup.call({ id }, actor));
  if (!popup) notFound();

  const [t, segments, newsletters, library, performance] = await Promise.all([
    getT(),
    domainOrNull(listSegments.call({}, actor)),
    domainOrNull(listNewsletters.call({}, actor)),
    domainOrNull(listAssets.call({}, actor)),
    domainOrNull(popupPerformance.call({ sinceDays: 30, popupId: id }, actor)),
  ]);
  const canManage = hasModuleAccess(actor, "popups", "manage");
  const counts = performance?.[0] ?? { shown: 0, dismissed: 0, captured: 0 };

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/popups" className="text-sm text-ink-muted">
          {t("popups.back")}
        </a>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight">{popup.name}</h1>
          <Pill tone={popup.status === "active" ? "success" : "neutral"}>
            {t(`popups.status.${popup.status}`)}
          </Pill>
        </div>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("popups.editIntro")}</p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("popups.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("popups.compose")} />
        <CardBody>
          <p className="max-w-prose text-sm text-ink-muted">{t("popups.composeIntro")}</p>
          {canManage ? (
            <PopupEditor
              popupId={popup.id}
              initialBlocks={popup.blocks as BlockNode[]}
              blockTypes={editorBlockTypes(
                t,
                "chrome",
                (library?.rows ?? []).map((asset) => ({
                  id: asset.id,
                  filename: asset.filename,
                  kind: asset.kind,
                })),
              )}
              labels={editorLabels(t)}
            />
          ) : (
            <p className="text-sm text-ink-muted">{t("popups.readOnly")}</p>
          )}
        </CardBody>
      </Card>

      {canManage ? (
        <form action={savePopupAction} className="grid gap-6">
          <input type="hidden" name="id" value={popup.id} />

          <Card>
            <CardHeader title={t("popups.basics")} />
            <CardBody>
              <div className="grid gap-3 md:grid-cols-3">
                <Field label={t("popups.field.name")} htmlFor="name">
                  <Input id="name" name="name" required defaultValue={popup.name} maxLength={120} />
                </Field>
                <Field label={t("popups.field.slug")} htmlFor="slug" hint={t("popups.field.slugHint")}>
                  <Input id="slug" name="slug" required defaultValue={popup.slug} />
                </Field>
                <Field label={t("popups.field.title")} htmlFor="title" hint={t("popups.field.titleHint")}>
                  <Input id="title" name="title" required defaultValue={popup.title} maxLength={160} />
                </Field>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <Field label={t("popups.field.surface")} htmlFor="surface">
                  <Select id="surface" name="surface" defaultValue={popup.surface}>
                    <option value="modal">{t("popups.surface.modal")}</option>
                    <option value="banner">{t("popups.surface.banner")}</option>
                    <option value="corner">{t("popups.surface.corner")}</option>
                  </Select>
                </Field>
                <Field label={t("popups.field.trigger")} htmlFor="trigger">
                  <Select id="trigger" name="trigger" defaultValue={popup.trigger}>
                    <option value="immediate">{t("popups.trigger.immediate")}</option>
                    <option value="delay">{t("popups.trigger.delay")}</option>
                    <option value="scroll">{t("popups.trigger.scroll")}</option>
                    <option value="exitIntent">{t("popups.trigger.exitIntent")}</option>
                  </Select>
                </Field>
                <Field
                  label={t("popups.field.triggerValue")}
                  htmlFor="triggerValue"
                  hint={t("popups.field.triggerValueHint")}
                >
                  <Input
                    id="triggerValue"
                    name="triggerValue"
                    type="number"
                    min={0}
                    max={600}
                    defaultValue={popup.triggerValue}
                  />
                </Field>
              </div>
              {/* Said once, where the choice is made. An exit-intent popup that
                  silently never runs on a phone is a support question. */}
              <Callout tone="neutral">{t("popups.exitIntentNote")}</Callout>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("popups.where")} />
            <CardBody>
              <p className="max-w-prose text-sm text-ink-muted">{t("popups.whereIntro")}</p>
              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label={t("popups.field.paths")}
                  htmlFor="pathPatterns"
                  hint={t("popups.field.pathsHint")}
                >
                  <textarea
                    id="pathPatterns"
                    name="pathPatterns"
                    rows={4}
                    className={CONTROL}
                    defaultValue={asStrings(popup.pathPatterns).join("\n")}
                  />
                </Field>
                <Field
                  label={t("popups.field.locales")}
                  htmlFor="locales"
                  hint={t("popups.field.localesHint")}
                >
                  <textarea
                    id="locales"
                    name="locales"
                    rows={4}
                    className={CONTROL}
                    defaultValue={asStrings(popup.locales).join("\n")}
                  />
                </Field>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <Field label={t("popups.field.startsAt")} htmlFor="startsAt">
                  <Input id="startsAt" name="startsAt" type="date" defaultValue={asDateInput(popup.startsAt)} />
                </Field>
                <Field label={t("popups.field.endsAt")} htmlFor="endsAt">
                  <Input id="endsAt" name="endsAt" type="date" defaultValue={asDateInput(popup.endsAt)} />
                </Field>
                <Field
                  label={t("popups.field.priority")}
                  htmlFor="priority"
                  hint={t("popups.field.priorityHint")}
                >
                  <Input
                    id="priority"
                    name="priority"
                    type="number"
                    min={0}
                    max={1000}
                    defaultValue={popup.priority}
                  />
                </Field>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("popups.who")} />
            <CardBody>
              <p className="max-w-prose text-sm text-ink-muted">{t("popups.whoIntro")}</p>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label={t("popups.field.audience")} htmlFor="audience">
                  <Select id="audience" name="audience" defaultValue={popup.audience}>
                    <option value="everyone">{t("popups.audienceSummary.everyone")}</option>
                    <option value="inSegment">{t("popups.audienceSummary.inSegment")}</option>
                    <option value="notInSegment">{t("popups.audienceSummary.notInSegment")}</option>
                  </Select>
                </Field>
                <Field
                  label={t("popups.field.segment")}
                  htmlFor="segmentId"
                  hint={t("popups.field.segmentHint")}
                >
                  <Select id="segmentId" name="segmentId" defaultValue={popup.segmentId ?? ""}>
                    <option value="">{t("popups.field.noSegment")}</option>
                    {(segments ?? []).map((segment) => (
                      <option key={segment.id} value={segment.id}>
                        {segment.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("popups.howOften")} />
            <CardBody>
              <p className="max-w-prose text-sm text-ink-muted">{t("popups.howOftenIntro")}</p>
              <div className="grid gap-3 md:grid-cols-3">
                <Field
                  label={t("popups.field.frequencyCap")}
                  htmlFor="frequencyCap"
                  hint={t("popups.field.frequencyCapHint")}
                >
                  <Input
                    id="frequencyCap"
                    name="frequencyCap"
                    type="number"
                    min={1}
                    max={100}
                    defaultValue={popup.frequencyCap ?? ""}
                  />
                </Field>
                <Field label={t("popups.field.frequencyPeriod")} htmlFor="frequencyPeriodHours">
                  <Input
                    id="frequencyPeriodHours"
                    name="frequencyPeriodHours"
                    type="number"
                    min={1}
                    max={8760}
                    defaultValue={popup.frequencyPeriodHours}
                  />
                </Field>
                <Field
                  label={t("popups.field.dismissSuppress")}
                  htmlFor="dismissSuppressHours"
                  hint={t("popups.field.dismissSuppressHint")}
                >
                  <Input
                    id="dismissSuppressHours"
                    name="dismissSuppressHours"
                    type="number"
                    min={0}
                    max={8760}
                    defaultValue={popup.dismissSuppressHours}
                  />
                </Field>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  name="stopAfterCapture"
                  value="1"
                  defaultChecked={popup.stopAfterCapture}
                />
                {t("popups.field.stopAfterCapture")}
              </label>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("popups.capture")} />
            <CardBody>
              <p className="max-w-prose text-sm text-ink-muted">{t("popups.captureIntro")}</p>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label={t("popups.field.captureMode")} htmlFor="captureMode">
                  <Select id="captureMode" name="captureMode" defaultValue={popup.captureMode}>
                    <option value="none">{t("popups.captureMode.none")}</option>
                    <option value="email">{t("popups.captureMode.email")}</option>
                  </Select>
                </Field>
                <Field
                  label={t("popups.field.newsletter")}
                  htmlFor="newsletterId"
                  hint={t("popups.field.newsletterHint")}
                >
                  <Select id="newsletterId" name="newsletterId" defaultValue={popup.newsletterId ?? ""}>
                    <option value="">{t("popups.field.noNewsletter")}</option>
                    {(newsletters ?? []).map((letter) => (
                      <option key={letter.id} value={letter.id}>
                        {letter.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="mt-3 grid gap-3">
                <Field
                  label={t("popups.field.consentStatement")}
                  htmlFor="consentStatement"
                  hint={t("popups.field.consentStatementHint")}
                >
                  <textarea
                    id="consentStatement"
                    name="consentStatement"
                    rows={3}
                    maxLength={600}
                    className={CONTROL}
                    defaultValue={popup.consentStatement ?? ""}
                  />
                </Field>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field
                    label={t("popups.field.consentVersion")}
                    htmlFor="consentVersion"
                    hint={t("popups.field.consentVersionHint")}
                  >
                    <Input
                      id="consentVersion"
                      name="consentVersion"
                      maxLength={60}
                      defaultValue={popup.consentVersion ?? ""}
                    />
                  </Field>
                  <Field label={t("popups.field.successMessage")} htmlFor="successMessage">
                    <Input
                      id="successMessage"
                      name="successMessage"
                      maxLength={400}
                      defaultValue={popup.successMessage ?? ""}
                    />
                  </Field>
                </div>
              </div>
            </CardBody>
          </Card>

          <Button type="submit" className="w-fit">
            {t("common.save")}
          </Button>
        </form>
      ) : null}

      <Card>
        <CardHeader title={t("popups.performanceTitle")} />
        <CardBody>
          <p className="max-w-prose text-sm text-ink-muted">{t("popups.performanceIntro")}</p>
          <p className="text-sm text-ink-muted">
            {t("popups.performance", {
              shown: counts.shown,
              dismissed: counts.dismissed,
              captured: counts.captured,
            })}
          </p>
          {canManage ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {(["active", "paused", "draft"] as const)
                .filter((status) => status !== popup.status)
                .map((status) => (
                  <form key={status} action={setPopupStatusAction}>
                    <input type="hidden" name="id" value={popup.id} />
                    <input type="hidden" name="status" value={status} />
                    <input type="hidden" name="returnTo" value={`/admin/popups/${popup.id}`} />
                    <button
                      type="submit"
                      className="rounded-md border border-rule px-3 py-1.5 text-sm text-ink"
                    >
                      {t(`popups.setStatus.${status}`)}
                    </button>
                  </form>
                ))}
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
