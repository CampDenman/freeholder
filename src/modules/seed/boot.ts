// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Installing the demo at boot, when the deploy asked for it.
//
// §3 promises "a fresh deploy is instantly explorable", and §15.2's SEO gate
// needs a site to crawl inside a container it did not build. Both want the
// same thing: a deploy that arrives populated, without a second command and
// without an endpoint that could ever be reached from outside.
//
// An environment variable rather than a route, because a route that installs a
// demo business is a route somebody eventually hits on a real instance. This
// cannot be triggered by a request at all — it is read once, at startup, by
// the process that owns the database.
import { env } from "@/core/env";

/**
 * Install the demo if `FREEHOLDER_SEED_DEMO=1` and the site is empty.
 *
 * Failure is reported and swallowed. A demo that cannot install is a reason to
 * look at the logs, not a reason for the instance to refuse to serve — and the
 * one thing worse than an unseeded demo is a deploy that crash-loops because
 * of the sample content.
 */
export async function seedDemoIfRequested(): Promise<void> {
  if (env().FREEHOLDER_SEED_DEMO !== "1") return;

  try {
    const { installDemo } = await import("./service");
    const result = await installDemo.call({ publish: true }, { kind: "system" });
    console.log(
      `[freeholder] demo installed: ${result.business}, ${result.pages.length} pages, ${result.assets} images`,
    );
  } catch (error) {
    // The expected failure is "this instance already has pages", which is what
    // a restart of a seeded container looks like. Said plainly rather than as
    // a stack trace, because it is not a fault.
    const message = error instanceof Error ? error.message : String(error);
    console.log(`[freeholder] demo not installed: ${message}`);
  }
}
