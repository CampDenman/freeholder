// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Keep executable CI dependencies immutable after the initial hardening pass.
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const githubRoot = join(root, ".github");
const ACTION = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.\/-]+)?@([a-f0-9]{40})$/;
const CONTAINER = /^\S+@sha256:[a-f0-9]{64}$/;
const SECRET_SCAN = "trufflesecurity/trufflehog@";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

async function yamlFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await yamlFiles(path));
    else if ([".yml", ".yaml"].includes(extname(entry.name))) found.push(path);
  }
  return found;
}

export function inspectWorkflowSource(source, path = "workflow") {
  const errors = [];
  if (/^\s*pull_request_target\s*:/m.test(source)) {
    errors.push(`${path}: pull_request_target is forbidden for repository code`);
  }
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const match = line.match(/^\s*(?:-\s*)?uses:\s*["']?([^\s"'#]+)["']?(?:\s+#.*)?$/);
    if (!match) continue;
    const reference = match[1];
    if (reference.startsWith("./")) continue;
    if (!ACTION.test(reference)) {
      errors.push(
        `${path}:${index + 1}: external action must use an immutable 40-character commit SHA (${reference})`,
      );
    }
  }
  if (/\bversion:\s*["']?latest["']?(?:\s+#.*)?$/m.test(source)) {
    errors.push(`${path}: action-managed tool versions must not use latest`);
  }
  return errors;
}

/** Enforce immutable container identities in job and service declarations. */
export function inspectWorkflowDocument(source, path = "workflow") {
  let document;
  try {
    document = record(parse(source));
  } catch (error) {
    return [`${path}: invalid YAML (${error instanceof Error ? error.message : "parse error"})`];
  }
  const jobs = record(document?.jobs);
  if (!jobs) return [];
  const triggers = record(document?.on);
  const errors = [];
  const inspectContainer = (value, label) => {
    const image = typeof value === "string" ? value : record(value)?.image;
    if (typeof image === "string" && !image.includes("${{") && !CONTAINER.test(image)) {
      errors.push(`${path}: ${label} image must use an immutable sha256 digest (${image})`);
    }
  };
  for (const [jobName, jobValue] of Object.entries(jobs)) {
    const job = record(jobValue);
    if (!job) continue;
    if (job.container !== undefined) inspectContainer(job.container, `job ${jobName}`);
    const services = record(job.services);
    for (const [serviceName, service] of Object.entries(services ?? {})) {
      inspectContainer(service, `service ${jobName}.${serviceName}`);
    }
    const steps = Array.isArray(job.steps) ? job.steps : [];
    for (const [stepIndex, stepValue] of steps.entries()) {
      const step = record(stepValue);
      if (
        typeof step?.uses === "string" &&
        step.uses.startsWith("actions/checkout@") &&
        record(step.with)?.["persist-credentials"] !== false
      ) {
        errors.push(
          `${path}: checkout in job ${jobName} step ${stepIndex + 1} must set persist-credentials: false`,
        );
      }
      if (typeof step?.uses === "string" && step.uses.startsWith(SECRET_SCAN)) {
        const inputs = record(step.with);
        const base = typeof inputs?.base === "string" ? inputs.base : "";
        const head = typeof inputs?.head === "string" ? inputs.head : "";
        const args = typeof inputs?.extra_args === "string" ? inputs.extra_args : "";
        const requiredRanges = [
          ["pull_request", "github.event.pull_request.base.sha", "github.event.pull_request.head.sha"],
          ["merge_group", "github.event.merge_group.base_sha", "github.event.merge_group.head_sha"],
          ["push", "github.event.before", "github.sha"],
        ];
        for (const [event, expectedBase, expectedHead] of requiredRanges) {
          if (triggers?.[event] !== undefined && (!base.includes(expectedBase) || !head.includes(expectedHead))) {
            errors.push(
              `${path}: TruffleHog in job ${jobName} must bind ${event} to ${expectedBase}..${expectedHead}`,
            );
          }
        }
        if (!args.includes("--results=verified,unknown") || !args.includes("--fail-on-scan-errors")) {
          errors.push(
            `${path}: TruffleHog in job ${jobName} must fail on verified/unknown findings and scan errors`,
          );
        }
      }
    }
  }
  return errors;
}

/**
 * Branch protection requires the check named `checks`. GitHub treats a skipped
 * required check as success, so the fan-in job must keep running after a
 * failed dependency and then fail unless every needed job succeeded.
 */
export function inspectProtectedFanIn(source, path = "workflow") {
  let document;
  try {
    document = record(parse(source));
  } catch (error) {
    return [`${path}: invalid YAML (${error instanceof Error ? error.message : "parse error"})`];
  }
  const jobs = record(document?.jobs);
  if (!jobs) return [`${path}: protected fan-in workflow must declare jobs`];
  const errors = [];
  const fanIn = Object.entries(jobs).find(([, jobValue]) => record(jobValue)?.name === "checks")
    ?? Object.entries(jobs).find(([jobName]) => jobName === "checks");
  if (!fanIn) {
    return [`${path}: protected fan-in job named checks is missing`];
  }
  const [jobName, jobValue] = fanIn;
  const job = record(jobValue) ?? {};
  const condition = typeof job.if === "string" ? job.if : "";
  if (!condition.includes("always()")) {
    errors.push(
      `${path}: job ${jobName} (checks) must use if: always() so a failed dependency cannot skip the required check`,
    );
  }
  const needs = job.needs;
  const needed = Array.isArray(needs) ? needs.filter((name) => typeof name === "string") : [];
  if (needed.length === 0) {
    errors.push(`${path}: job ${jobName} (checks) must declare needs for every required gate`);
  }
  const steps = Array.isArray(job.steps) ? job.steps : [];
  const verifies = steps.some((stepValue) => {
    const step = record(stepValue);
    const script = typeof step?.run === "string" ? step.run : "";
    const env = record(step?.env);
    const needsJson = typeof env?.NEEDS === "string" ? env.NEEDS : "";
    return (
      (script.includes(".result") || needsJson.includes("toJSON(needs)") || script.includes("needs."))
      && (script.includes("success") || script.includes('jq -e'))
    );
  });
  if (!verifies) {
    errors.push(
      `${path}: job ${jobName} (checks) must fail unless every needed job result is success`,
    );
  }
  return errors;
}

async function main() {
  const errors = [];
  for (const path of await yamlFiles(githubRoot)) {
    const label = relative(root, path).replaceAll("\\", "/");
    const source = await readFile(path, "utf8");
    errors.push(...inspectWorkflowSource(source, label));
    errors.push(...inspectWorkflowDocument(source, label));
    if (label === ".github/workflows/ci.yml") {
      errors.push(...inspectProtectedFanIn(source, label));
    }
  }
  if (errors.length > 0) {
    throw new Error(`Workflow integrity failed:\n${errors.map((error) => `  - ${error}`).join("\n")}`);
  }
  console.log(
    "Workflow integrity: actions and containers are immutable; checkout credentials are ephemeral.",
  );
}

if (process.argv[1]?.endsWith("workflow-integrity-gate.mjs")) await main();
