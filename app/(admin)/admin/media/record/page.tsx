// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Screen, camera and microphone capture plus phone ingest (C1.28, C1.29).

import { getCaptureSession, listCaptureSessions } from "@/core/media/capture";
import { listProducts } from "@/modules/catalog/service";
import { listPages } from "@/modules/cms/service";
import { Button, Card, CardBody, CardHeader, Field } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import {
  createPhoneLinkAction,
  startRecordingAction,
} from "../../../capture-actions";
import { RecordStudio } from "../RecordStudio";

export const dynamic = "force-dynamic";

export default async function MediaRecordPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string; link?: string }>;
}) {
  const actor = await requireStaffActor("media", "manage");
  const query = await searchParams;
  const [sessions, t, current, link, products, pages] = await Promise.all([
    listCaptureSessions.call({}, actor),
    getT(),
    query.session ? getCaptureSession.call({ id: query.session }, actor) : null,
    query.link ? getCaptureSession.call({ id: query.link }, actor) : null,
    listProducts.call({ limit: 100 }, actor).catch(() => []),
    listPages.call({}, actor).catch(() => []),
  ]);

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/media" className="text-sm text-ink-muted">{t("media.capture.back")}</a>
        <h1 className="mt-2 text-xl font-bold tracking-tight">{t("media.capture.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("media.capture.intro")}</p>
      </div>

      <Card>
        <CardHeader title={t("media.capture.start")} />
        <CardBody>
          <div className="flex flex-wrap gap-2">
            {(["screen", "camera", "microphone"] as const).map((source) => (
              <form key={source} action={startRecordingAction}>
                <input type="hidden" name="source" value={source} />
                <Button type="submit">{t(`media.capture.source.${source}`)}</Button>
              </form>
            ))}
            <form action={createPhoneLinkAction} className="grid gap-3 sm:grid-cols-2">
              <Field label={t("media.capture.target")} htmlFor="targetType">
                <select
                  id="targetType"
                  name="targetType"
                  className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
                  defaultValue="library"
                >
                  <option value="library">{t("media.capture.target.library")}</option>
                  <option value="product">{t("media.capture.target.product")}</option>
                  <option value="page">{t("media.capture.target.page")}</option>
                </select>
              </Field>
              <Field label={t("media.capture.targetId")} htmlFor="targetId">
                <select
                  id="targetId"
                  name="targetId"
                  className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
                  defaultValue=""
                >
                  <option value="">{t("media.capture.target.none")}</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {t("media.capture.target.product")}: {product.name}
                    </option>
                  ))}
                  {pages.map((page) => (
                    <option key={page.id} value={page.id}>
                      {t("media.capture.target.page")}: {page.workingTitle ?? page.title}
                    </option>
                  ))}
                </select>
              </Field>
              <input type="hidden" name="source" value="upload_link" />
              <Button type="submit">{t("media.capture.phoneLink")}</Button>
            </form>
          </div>
        </CardBody>
      </Card>

      {current ? (
        <RecordStudio
          session={current}
          labels={{
            title: t(`media.capture.source.${current.source}`),
            grant: t("media.capture.grant"),
            record: t("media.capture.record"),
            stop: t("media.capture.stop"),
            live: t("media.capture.live"),
            caption: t("media.capture.caption"),
            trimStart: t("media.capture.trimStart"),
            trimEnd: t("media.capture.trimEnd"),
            cropX: t("media.capture.cropX"),
            cropY: t("media.capture.cropY"),
            saveReview: t("media.capture.saveReview"),
            confirm: t("media.capture.confirm"),
            discard: t("media.capture.discard"),
          }}
        />
      ) : null}

      {link?.captureUrl ? (
        <Card>
          <CardHeader title={t("media.capture.phoneLink")} />
          <CardBody>
            <p className="text-sm text-ink-muted">{t("media.capture.phoneHint")}</p>
            <p className="mt-2 break-all font-mono text-sm">{link.captureUrl}</p>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t("media.capture.recent")} />
        <CardBody>
          <ul className="grid list-none gap-2 p-0 text-sm">
            {sessions.length === 0 ? <li className="text-ink-muted">{t("media.capture.empty")}</li> : null}
            {sessions.slice(0, 12).map((session) => (
              <li key={session.id}>
                <a href={`/admin/media/record?session=${session.id}`} className="font-semibold text-ink">
                  {t(`media.capture.source.${session.source}`)}
                </a>
                <span className="text-ink-muted"> · {t(`media.capture.status.${session.status}`)}</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
