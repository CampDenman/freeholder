// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Print-on-demand fulfillment (MASTER.md §36, C3.13).
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Field, Input, Pill } from "@/ui/primitives";
import { listPodJobs, listPodMaps } from "../../../../plugins/print-on-demand/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import {
  mapPodSkuAction,
  queuePodJobAction,
  retryPodJobAction,
} from "../../first-party-plugin-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PrintOnDemandPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("printOnDemand", "manage");
  const query = await searchParams;
  const [t, jobs, maps] = await Promise.all([
    getT(),
    domainOrNull(listPodJobs.call({}, actor)),
    domainOrNull(listPodMaps.call({}, actor)),
  ]);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("pod.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("pod.intro")}</p>
      </div>
      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("pod.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error}
        </p>
      ) : null}
      <Card>
        <CardHeader title={t("pod.map")} />
        <CardBody>
          <form action={mapPodSkuAction} className="grid gap-3 sm:grid-cols-3">
            <Field label={t("pod.field.sku")} htmlFor="pod-map-sku">
              <Input id="pod-map-sku" name="sku" required />
            </Field>
            <Field label={t("pod.field.provider")} htmlFor="pod-map-provider">
              <Input id="pod-map-provider" name="provider" defaultValue="printify" required />
            </Field>
            <Field label={t("pod.field.providerProduct")} htmlFor="pod-map-product">
              <Input id="pod-map-product" name="providerProductId" required />
            </Field>
            <div className="sm:col-span-3">
              <Button type="submit">{t("pod.map")}</Button>
            </div>
          </form>
          {(maps ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-ink-muted">{t("pod.maps.empty")}</p>
          ) : (
            <ul className="mt-4 grid list-none gap-2 p-0">
              {(maps ?? []).map((mapped) => (
                <li key={mapped.id} className="rounded-md border border-rule p-3 text-sm">
                  {mapped.sku} → {mapped.provider} / {mapped.providerProductId}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("pod.queue")} />
        <CardBody>
          <form action={queuePodJobAction} className="grid gap-3 sm:grid-cols-2">
            <Field label={t("pod.field.sku")} htmlFor="pod-sku">
              <Input id="pod-sku" name="sku" required />
            </Field>
            <Field label={t("pod.field.provider")} htmlFor="pod-provider">
              <Input id="pod-provider" name="provider" defaultValue="printify" required />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit">{t("pod.queue")}</Button>
            </div>
          </form>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("pod.list")} />
        <CardBody>
          {(jobs ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">{t("pod.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {(jobs ?? []).map((job) => (
                <li key={job.id} className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm">
                  <span>{job.sku}</span>
                  {job.orderId ? (
                    <span className="text-ink-muted">
                      {t("pod.field.order")} {job.orderId}
                    </span>
                  ) : null}
                  <Pill tone={job.status === "submitted" ? "success" : job.status === "failed" ? "danger" : "neutral"}>
                    {t(`pod.status.${job.status}`)}
                  </Pill>
                  {job.externalRef ? <span className="text-ink-muted">{job.externalRef}</span> : null}
                  {job.lastError ? <span className="text-danger">{job.lastError}</span> : null}
                  {job.status === "failed" || job.status === "queued" ? (
                    <form action={retryPodJobAction}>
                      <input type="hidden" name="jobId" value={job.id} />
                      <Button type="submit" variant="quiet">
                        {t("pod.retry")}
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
