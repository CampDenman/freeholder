// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// No-app phone ingest (MASTER.md C1.29).

import { notFound } from "next/navigation";
import { getCaptureSession } from "@/core/media/capture";
import { Button } from "@/ui/primitives";
import { getT } from "../../i18n";
import { confirmCaptureAction } from "../../(admin)/capture-actions";
import { UploadForm } from "../../(admin)/admin/media/UploadForm";

export const dynamic = "force-dynamic";

export default async function CaptureLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [session, t] = await Promise.all([
    getCaptureSession.call({ token }, { kind: "anonymous" }),
    getT(),
  ]);
  if (!session || session.status === "expired") notFound();

  return (
    <main className="mx-auto grid max-w-lg gap-6 px-6 py-10">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("media.capture.phoneTitle")}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t("media.capture.phoneBody")}</p>
      </div>
      {session.status === "confirmed" ? (
        <p className="text-sm text-success">{t("media.capture.confirmed")}</p>
      ) : (
        <>
          <UploadForm
            captureToken={token}
            labels={{
              file: t("media.capture.file"),
              fileHint: t("media.fileHint"),
              submit: t("media.capture.upload"),
              pending: t("media.uploading"),
              failed: t("media.uploadFailed"),
              progress: t("media.uploadProgress"),
              resumable: t("media.uploadResuming"),
              cancel: t("common.cancel"),
            }}
          />
          {session.assetId ? (
            <form action={confirmCaptureAction}>
              <input type="hidden" name="token" value={token} />
              <Button type="submit">{t("media.capture.confirm")}</Button>
            </form>
          ) : null}
        </>
      )}
    </main>
  );
}
