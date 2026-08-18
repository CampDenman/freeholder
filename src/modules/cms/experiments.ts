// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Server-side sticky experiment assignment (C2.17).
//
// Variants live in the block tree. Assignment is a hash of the first-party
// visitor id and the experiment key, so the same visitor sees the same
// variant without a client-side swap. Crawlers and visitors without an id
// get the first variant (the control).
import { createHash } from "node:crypto";
import type { BlockNode } from "./blocks/types";

export const EXPERIMENT_TYPE = "experiment";
export const VARIANT_TYPE = "variant";

export interface VariantSpec {
  name: string;
  weight: number;
}

export function variantSpecs(children: BlockNode[] | undefined): VariantSpec[] {
  const specs: VariantSpec[] = [];
  for (const child of children ?? []) {
    if (child.type !== VARIANT_TYPE) continue;
    const name = typeof child.props.name === "string" ? child.props.name.trim() : "";
    const weight =
      typeof child.props.weight === "number" && child.props.weight > 0
        ? child.props.weight
        : 1;
    if (name) specs.push({ name, weight });
  }
  return specs;
}

export function bucket(visitorId: string, experimentKey: string, total: number): number {
  const digest = createHash("sha256")
    .update(`${visitorId}\0${experimentKey}`)
    .digest();
  const n = digest.readUInt32BE(0);
  return total > 0 ? n % total : 0;
}

export function assignVariant(
  experimentKey: string,
  variants: VariantSpec[],
  visitorId: string | null | undefined,
): string {
  if (variants.length === 0) return "control";
  if (!visitorId) return variants[0]!.name;
  const total = variants.reduce((sum, row) => sum + row.weight, 0);
  const n = bucket(visitorId, experimentKey, total);
  let acc = 0;
  for (const row of variants) {
    acc += row.weight;
    if (n < acc) return row.name;
  }
  return variants[variants.length - 1]!.name;
}

export function collectExperiments(
  nodes: BlockNode[],
  into: { key: string; variants: VariantSpec[] }[] = [],
): { key: string; variants: VariantSpec[] }[] {
  for (const node of nodes) {
    if (node.type === EXPERIMENT_TYPE) {
      const key =
        typeof node.props.experimentKey === "string" ? node.props.experimentKey.trim() : "";
      if (key) into.push({ key, variants: variantSpecs(node.children) });
    }
    if (node.children) collectExperiments(node.children, into);
  }
  return into;
}

export function assignmentsFor(
  nodes: BlockNode[],
  visitorId: string | null | undefined,
  existing: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const next = { ...existing };
  for (const experiment of collectExperiments(nodes)) {
    if (next[experiment.key]) continue;
    next[experiment.key] = assignVariant(experiment.key, experiment.variants, visitorId);
  }
  return next;
}

export function experimentCacheKey(assignments: Readonly<Record<string, string>>): string {
  return Object.keys(assignments)
    .sort()
    .map((key) => `${key}=${assignments[key]}`)
    .join("&");
}

export function selectAssignedVariants(
  experimentKey: string,
  children: BlockNode[],
  assignments: Readonly<Record<string, string>> | undefined,
  visitorId: string | null | undefined,
  showAll: boolean,
): BlockNode[] {
  const variants = children.filter((child) => child.type === VARIANT_TYPE);
  if (showAll || variants.length === 0) return children;
  const chosen =
    assignments?.[experimentKey] ??
    assignVariant(experimentKey, variantSpecs(variants), visitorId);
  const match = variants.find((child) => child.props.name === chosen);
  return match ? [match] : variants.slice(0, 1);
}
