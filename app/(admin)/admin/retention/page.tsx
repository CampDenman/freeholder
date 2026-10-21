// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Per-kind retention clocks for user-owned stores (C11.14). Legal, audit and
// accounting rows stay off this page.
import type { Metadata } from "next";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
} from "@/ui/primitives";
import { listRetentionPolicies } from "@/core/retention/service";
import { hasModuleAccess } from "@/core/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import {
  applyRetentionAction,
  upsertRetentionPolicyAction,
} from "../../retention-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminRetentionPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("retention");
  const [t, listed, query] = await Promise.all([
    getT(),
    domainOrNull(listRetentionPolicies.call({}, actor)),
    searchParams,
  ]);
  const canManage = hasModuleAccess(actor, "retention", "manage");
  const kinds = listed?.kinds ?? [];
  const policies = listed?.policies ?? [];
  const ttlByKind = new Map(policies.map((row) => [row.kind, row.ttlDays]));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("admin.retention.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("admin.retention.intro")}</p>
      </div>

      {query.saved === "policy" ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("admin.retention.saved")}
        </p>
      ) : null}
      {query.saved === "apply" ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("admin.retention.applied")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error.includes(" ") ? query.error : t("admin.retention.failed")}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("admin.retention.policies")} />
        <CardBody>
          {listed === null ? (
            <p className="text-sm text-danger">{t("admin.retention.unavailable")}</p>
          ) : policies.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("admin.retention.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {policies.map((policy) => (
                <li
                  key={policy.kind}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                >
                  <span className="font-medium">{policy.kind}</span>
                  <span className="text-ink-muted">
                    {t("admin.retention.keptDays", { days: policy.ttlDays })}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!canManage ? (
            <p className="text-sm text-ink-muted">{t("admin.retention.readOnly")}</p>
          ) : null}
        </CardBody>
      </Card>

      {canManage && listed !== null ? (
        <Card>
          <CardHeader title={t("admin.retention.addTitle")} />
          <CardBody>
            <form action={upsertRetentionPolicyAction} className="grid max-w-md gap-4">
              <Field label={t("admin.retention.kind")} htmlFor="retention-kind">
                <Select id="retention-kind" name="kind" required defaultValue={kinds[0]?.kind}>
                  {kinds.map((kind) => (
                    <option key={kind.kind} value={kind.kind}>
                      {kind.kind}
                      {ttlByKind.has(kind.kind)
                        ? ` (${ttlByKind.get(kind.kind)})`
                        : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={t("admin.retention.ttl")}
                htmlFor="retention-ttl"
                hint={t("admin.retention.ttlHint")}
              >
                <Input
                  id="retention-ttl"
                  name="ttlDays"
                  type="number"
                  min={1}
                  max={36500}
                  required
                  defaultValue={365}
                />
              </Field>
              <div>
                <Button type="submit">{t("admin.retention.save")}</Button>
              </div>
            </form>
          </CardBody>
        </Card>
      ) : null}

      {canManage && listed !== null ? (
        <Card>
          <CardHeader title={t("admin.retention.applyTitle")} />
          <CardBody>
            <p className="max-w-prose text-sm text-ink-muted">{t("admin.retention.applyIntro")}</p>
            <form action={applyRetentionAction}>
              <Button type="submit">{t("admin.retention.apply")}</Button>
            </form>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
