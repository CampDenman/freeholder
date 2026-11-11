// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";

import { useActionState, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiJson } from "../media/upload-client";
import { Button, Field, Input, Select } from "@/ui/primitives";
import {
  commitImportAction,
  crawlImportAction,
  mapImportAction,
  previewImportAction,
  publishImportAction,
  reconcileImportAction,
  reviewImportConflictsAction,
  rollbackImportAction,
  startImportAction,
  type ImportActionState,
} from "../../import-actions";

const empty: ImportActionState = {};

export function StartImportForm({
  labels,
}: {
  labels: {
    origin: string;
    kind: string;
    kinds: Array<{ value: string; label: string }>;
    submit: string;
    error: string;
  };
}) {
  const [state, action] = useActionState(startImportAction, empty);
  return (
    <form action={action} className="grid min-w-0 gap-4">
      {state.error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {state.error}
        </p>
      ) : null}
      <Field htmlFor="origin" label={labels.origin}>
        <Input id="origin" name="origin" type="url" dir="ltr" required />
      </Field>
      <Field htmlFor="kind" label={labels.kind}>
        <Select id="kind" name="kind" defaultValue="html" required>
          {labels.kinds.map((kind) => (
            <option key={kind.value} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit">{labels.submit}</Button>
    </form>
  );
}

export function ImportStepForms({
  id,
  status,
  sourceKind,
  origin,
  labels,
}: {
  id: string;
  status: string;
  sourceKind: string;
  origin: string;
  labels: {
    preview: string;
    url: string;
    slug: string;
    slugHint: string;
    title: string;
    pageKind: string;
    page: string;
    post: string;
    map: string;
    review: string;
    keep: string;
    replace: string;
    rename: string;
    renamedSlug: string;
    commit: string;
    reconcile: string;
    publish: string;
    rollback: string;
    upload: string;
    uploadHint: string;
    stage: string;
    uploading: string;
    readingSource: string;
    uploadFailed: string;
    sourceUrl: string;
    crawl: string;
    crawlHint: string;
    crawling: string;
  };
}) {
  return (
    <div className="grid min-w-0 gap-4">
      {status === "discover" || status === "mapped" || status === "failed" || status === "previewed" ? (
        <div className="grid min-w-0 gap-6">
          {["wordpress-rest", "sitemap", "rss", "atom", "html"].includes(sourceKind) ? <CrawlSourceForm id={id} origin={origin} labels={labels} /> : null}
          <SourceUploadForm id={id} labels={labels} sourceKind={sourceKind} />
        </div>
      ) : null}
      {status === "discover" ? (
        <form action={mapImportAction} className="grid min-w-0 gap-3">
          <input type="hidden" name="id" value={id} />
          <Field htmlFor="map-url" label={labels.url}>
            <Input id="map-url" name="url" type="url" required />
          </Field>
          <Field htmlFor="map-slug" label={labels.slug}>
            <Input id="map-slug" name="slug" required />
          </Field>
          <Field htmlFor="map-title" label={labels.title}>
            <Input id="map-title" name="title" required />
          </Field>
          <Field htmlFor="map-kind" label={labels.pageKind}>
            <Select id="map-kind" name="kind" defaultValue="page">
              <option value="page">{labels.page}</option>
              <option value="post">{labels.post}</option>
            </Select>
          </Field>
          <Button type="submit">{labels.map}</Button>
        </form>
      ) : null}
      {status === "mapped" ? (
        <form action={previewImportAction} className="grid min-w-0 gap-3">
          <input type="hidden" name="id" value={id} />
          <Field htmlFor="url" label={labels.url}>
            <Input id="url" name="url" type="url" required />
          </Field>
          <Field htmlFor="slug" label={labels.slug}>
            <Input id="slug" name="slug" required />
          </Field>
          <Field htmlFor="title" label={labels.title}>
            <Input id="title" name="title" required />
          </Field>
          <Button type="submit">{labels.preview}</Button>
        </form>
      ) : null}
      {status === "previewed" ? (
        <form action={reviewImportConflictsAction} className="grid min-w-0 gap-3">
          <input type="hidden" name="id" value={id} />
          <Field htmlFor="conflict-slug" label={labels.slug} hint={labels.slugHint}>
            <Input id="conflict-slug" name="slug" />
          </Field>
          <Field htmlFor="conflict-resolution" label={labels.review}>
            <Select id="conflict-resolution" name="resolution" defaultValue="keep-existing">
              <option value="keep-existing">{labels.keep}</option>
              <option value="replace">{labels.replace}</option>
              <option value="rename">{labels.rename}</option>
            </Select>
          </Field>
          <Field htmlFor="conflict-renamed" label={labels.renamedSlug}>
            <Input id="conflict-renamed" name="renamedSlug" />
          </Field>
          <Button type="submit">{labels.review}</Button>
        </form>
      ) : null}
      {status === "previewed" ? (
        <form action={commitImportAction}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit">{labels.commit}</Button>
        </form>
      ) : null}
      {status === "committed" ? (
        <form action={reconcileImportAction}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit">{labels.reconcile}</Button>
        </form>
      ) : null}
      {status === "reconciled" ? (
        <form action={publishImportAction}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit">{labels.publish}</Button>
        </form>
      ) : null}
      {status !== "rolled_back" ? (
        <form action={rollbackImportAction}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit">{labels.rollback}</Button>
        </form>
      ) : null}
    </div>
  );
}

/**
 * An export file goes up in fixed chunks to the import-only chunk route, so
 * a real-size WordPress export never meets the 1 MB limit every other form
 * and JSON route keeps. The server reads it back as a stream and stages the
 * preview; nothing is written to the site until the batch is committed.
 */
function SourceUploadForm({
  id,
  labels,
  sourceKind,
}: {
  id: string;
  sourceKind: string;
  labels: {
    upload: string;
    uploadHint: string;
    stage: string;
    uploading: string;
    readingSource: string;
    uploadFailed: string;
  };
}) {
  const router = useRouter();
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("file");
    const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
    if (!file) return;
    setError(null);
    try {
      setProgress(labels.uploading);
      const reserved = await apiJson<{ uploadId: string; chunkBytes: number; chunkCount: number }>(
        "/api/v1/imports.beginSourceUpload",
        { method: "POST", body: JSON.stringify({ id, filename: file.name, bytes: file.size }) },
      );
      for (let index = 0; index < reserved.chunkCount; index += 1) {
        const part = file.slice(index * reserved.chunkBytes, (index + 1) * reserved.chunkBytes);
        const url = `/api/imports/source/chunk?id=${encodeURIComponent(id)}&uploadId=${encodeURIComponent(reserved.uploadId)}&index=${index}`;
        // One retry: a dropped connection should not cost the whole upload.
        for (let attempt = 0; ; attempt += 1) {
          try {
            await apiJson(url, { method: "POST", body: part, headers: { "content-type": "application/octet-stream" } });
            break;
          } catch (failure) {
            if (attempt >= 1) throw failure;
          }
        }
        setProgress(`${labels.uploading} ${Math.round(((index + 1) / reserved.chunkCount) * 100)}%`);
      }
      setProgress(labels.readingSource);
      const staged = await apiJson<{ status: string; error: string | null }>("/api/v1/imports.previewFromUpload", {
        method: "POST",
        body: JSON.stringify({ id, uploadId: reserved.uploadId }),
      });
      if (staged.status === "failed") setError(staged.error ?? labels.uploadFailed);
      setProgress(null);
      router.refresh();
    } catch (failure) {
      setProgress(null);
      setError(failure instanceof Error && failure.message ? failure.message : labels.uploadFailed);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid min-w-0 gap-3">
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      <Field htmlFor="source-file" label={labels.upload} hint={labels.uploadHint}>
        <input
          id="source-file"
          name="file"
          type="file"
          accept={sourceKind === "archive" ? ".zip,application/zip,application/x-zip-compressed" : ".xml,.json,.html,.htm,.rss,.atom,application/xml,text/xml,application/json,text/html"}
          required
          disabled={progress !== null}
          className="w-full min-w-0 max-w-full rounded-md border border-rule-strong bg-field px-2 py-1 text-sm"
        />
      </Field>
      {progress ? (
        <p role="status" className="text-sm text-ink-muted">
          {progress}
        </p>
      ) : null}
      <Button type="submit" disabled={progress !== null}>
        {labels.stage}
      </Button>
    </form>
  );
}


function CrawlSourceForm({ id, origin, labels }: { id: string; origin: string; labels: { sourceUrl: string; crawl: string; crawlHint: string; crawling: string } }) {
  const [state, action, pending] = useActionState(crawlImportAction, empty);
  return <form action={action} className="grid min-w-0 gap-3">
    <input type="hidden" name="id" value={id} />
    <Field htmlFor="import-source-url" label={labels.sourceUrl}>
      <Input id="import-source-url" name="sourceUrl" type="url" dir="ltr" defaultValue={origin} required aria-describedby="import-crawl-hint" />
    </Field>
    <p id="import-crawl-hint" className="text-sm text-ink-muted">{labels.crawlHint}</p>
    {state.error ? <p role="alert" className="text-sm font-medium text-danger">{state.error}</p> : null}
    <Button type="submit" disabled={pending}>{pending ? labels.crawling : labels.crawl}</Button>
  </form>;
}
