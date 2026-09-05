// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Popups: what is running, how it has done, and one place to start a new one
// (C9.30, MASTER.md §36).
//
// Performance sits on the list rather than behind a tab, because the numbers
// are the only way to tell an announcement people read from one people close.
// A popup shown four hundred times and closed three hundred and ninety is not
// a campaign; it is a toll, and an owner should be able to see that without
// going looking for it.
import type { Metadata } from "next";
import { Megaphone } from "@phosphor-icons/react/dist/ssr";
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
import { listPopups, popupPerformance } from "@/modules/popups/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import { deletePopupAction, savePopupAction, setPopupStatusAction } from "../../popup-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const STATUS_TONE = {
  draft: "neutral",
  active: "success",
  paused: "warning",
} as const;

export default async function PopupsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("popups");
  const query = await searchParams;
  const [t, all, performance] = await Promise.all([
    getT(),
    domainOrNull(listPopups.call({}, actor)),
    domainOrNull(popupPerformance.call({ sinceDays: 30 }, actor)),
  ]);
  const canManage = hasModuleAccess(actor, "popups", "manage");
  const counts = new Map((performance ?? []).map((each) => [each.popupId, each]));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("popups.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("popups.intro")}</p>
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

      <Callout tone="neutral">{t("popups.capNote")}</Callout>

      <Card>
        <CardHeader title={t("popups.running")} />
        <CardBody>
          {all === null || all.length === 0 ? (
            <div className="grid justify-items-start gap-3 py-6">
              <Megaphone size={26} weight="light" className="text-ink-muted" />
              <p className="max-w-prose text-sm text-ink-muted">{t("popups.empty")}</p>
            </div>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {all.map((popup) => {
                const seen = counts.get(popup.id);
                return (
                  <li key={popup.id} className="grid gap-2 rounded-md border border-rule p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-3">
                      <a
                        href={`/admin/popups/${popup.id}`}
                        className="font-medium underline decoration-rule underline-offset-2"
                      >
                        {popup.name}
                      </a>
                      <Pill tone={STATUS_TONE[popup.status]}>
                        {t(`popups.status.${popup.status}`)}
                      </Pill>
                      <Pill tone="neutral">{t(`popups.surface.${popup.surface}`)}</Pill>
                      {popup.captureMode === "email" ? (
                        <Pill tone="accent">{t("popups.collectsEmail")}</Pill>
                      ) : null}
                    </div>
                    <p className="text-ink-muted">
                      {popup.frequencyCap === null
                        ? t("popups.uncapped")
                        : t("popups.capSummary", {
                            count: popup.frequencyCap,
                            hours: popup.frequencyPeriodHours,
                          })}
                      {" · "}
                      {t(`popups.audienceSummary.${popup.audience}`)}
                      {" · "}
                      {t(`popups.trigger.${popup.trigger}`)}
                    </p>
                    {/* Thirty days, said in the label rather than assumed. */}
                    <p className="text-ink-muted">
                      {t("popups.performance", {
                        shown: seen?.shown ?? 0,
                        dismissed: seen?.dismissed ?? 0,
                        captured: seen?.captured ?? 0,
                      })}
                    </p>
                    {canManage ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {(["active", "paused", "draft"] as const)
                          .filter((status) => status !== popup.status)
                          .map((status) => (
                            <form key={status} action={setPopupStatusAction}>
                              <input type="hidden" name="id" value={popup.id} />
                              <input type="hidden" name="status" value={status} />
                              <input type="hidden" name="returnTo" value="/admin/popups" />
                              <button
                                type="submit"
                                className="rounded-md border border-rule px-3 py-1.5 text-sm text-ink"
                              >
                                {t(`popups.setStatus.${status}`)}
                              </button>
                            </form>
                          ))}
                        <form action={deletePopupAction}>
                          <input type="hidden" name="id" value={popup.id} />
                          <label className="flex items-center gap-2 text-sm text-ink-muted">
                            <input type="checkbox" name="confirm" value="1" required />
                            {t("popups.deleteConfirm")}
                          </label>
                          <button
                            type="submit"
                            className="rounded-md border border-rule px-3 py-1.5 text-sm text-danger"
                          >
                            {t("popups.delete")}
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader title={t("popups.newTitle")} />
          <CardBody>
            <p className="max-w-prose text-sm text-ink-muted">{t("popups.newIntro")}</p>
            <form action={savePopupAction} className="grid gap-3">
              <div className="grid gap-3 md:grid-cols-3">
                <Field label={t("popups.field.name")} htmlFor="popupName">
                  <Input id="popupName" name="name" required maxLength={120} />
                </Field>
                <Field
                  label={t("popups.field.slug")}
                  htmlFor="popupSlug"
                  hint={t("popups.field.slugHint")}
                >
                  <Input
                    id="popupSlug"
                    name="slug"
                    required
                    placeholder={t("popups.field.slugPlaceholder")}
                  />
                </Field>
                <Field
                  label={t("popups.field.title")}
                  htmlFor="popupTitle"
                  hint={t("popups.field.titleHint")}
                >
                  <Input id="popupTitle" name="title" required maxLength={160} />
                </Field>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <Field label={t("popups.field.surface")} htmlFor="popupSurface">
                  <Select id="popupSurface" name="surface" defaultValue="modal">
                    <option value="modal">{t("popups.surface.modal")}</option>
                    <option value="banner">{t("popups.surface.banner")}</option>
                    <option value="corner">{t("popups.surface.corner")}</option>
                  </Select>
                </Field>
                <Field label={t("popups.field.trigger")} htmlFor="popupTrigger">
                  <Select id="popupTrigger" name="trigger" defaultValue="delay">
                    <option value="immediate">{t("popups.trigger.immediate")}</option>
                    <option value="delay">{t("popups.trigger.delay")}</option>
                    <option value="scroll">{t("popups.trigger.scroll")}</option>
                    <option value="exitIntent">{t("popups.trigger.exitIntent")}</option>
                  </Select>
                </Field>
                <Field
                  label={t("popups.field.triggerValue")}
                  htmlFor="popupTriggerValue"
                  hint={t("popups.field.triggerValueHint")}
                >
                  <Input
                    id="popupTriggerValue"
                    name="triggerValue"
                    type="number"
                    min={0}
                    max={600}
                    defaultValue={5}
                  />
                </Field>
              </div>
              <Button type="submit" className="w-fit">
                {t("popups.create")}
              </Button>
            </form>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
