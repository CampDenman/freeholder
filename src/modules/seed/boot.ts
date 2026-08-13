// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Installing the demo at boot, when the deploy asked for it.
//
// §3 promises "a fresh deploy is instantly explorable", C1.24 makes that
// concrete for a contributor's first `pnpm dev`, and §15.2's SEO gate needs a
// site to crawl inside a container it did not build. All three want the same
// thing: a process that arrives populated, without a second command and
// without an endpoint that could ever be reached from outside.
//
// An environment variable rather than a route, because a route that installs a
// demo business is a route somebody eventually hits on a real instance. This
// cannot be triggered by a request at all — it is read once, at startup, by
// the process that owns the database.
import { env } from "@/core/env";
import { ServiceError } from "@/core/service";

export type DemoSeedOutcome =
  | { status: "skipped"; reason: "disabled" | "development-not-pristine" }
  | { status: "already-populated" }
  | {
      status: "installed";
      business: string;
      pages: string[];
      assets: number;
    };

/**
 * Whether this process should install the demo, and whether that request was
 * implicit. Kept pure so the default/override contract is testable without a
 * database.
 */
export function demoSeedMode(
  environment: Pick<ReturnType<typeof env>, "NODE_ENV" | "FREEHOLDER_SEED_DEMO">,
): "disabled" | "development" | "requested" {
  if (environment.FREEHOLDER_SEED_DEMO === "0") return "disabled";
  if (environment.FREEHOLDER_SEED_DEMO === "1") return "requested";
  return environment.NODE_ENV === "development" ? "development" : "disabled";
}

/**
 * Install the demo when explicitly requested, or on a pristine development
 * database when the switch is unset.
 *
 * An expected restart is harmless: the existing pages make the installer
 * decline before it writes. Every other failure is fatal. Serving a setup
 * placeholder after an operator explicitly requested a complete demo hides
 * the fault until somebody visits `/`; C1.24 requires the startup contract to
 * be true, not merely attempted.
 */
export async function seedDemoIfRequested(): Promise<DemoSeedOutcome> {
  const environment = env();
  const mode = demoSeedMode(environment);
  if (mode === "disabled") return { status: "skipped", reason: "disabled" };

  // Development's default must never reinterpret an in-progress real setup as
  // an empty demo just because its first page has not been created yet. The
  // explicit switch retains its documented "no pages" contract; the implicit
  // convenience applies only to a database that has neither owner nor profile.
  if (mode === "development") {
    const { setupState } = await import("@/core/settings/service");
    const state = await setupState.call({}, { kind: "anonymous" });
    if (state.hasOwner || state.hasBusiness) {
      console.log(
        "[freeholder] demo not installed: development database is not pristine",
      );
      return { status: "skipped", reason: "development-not-pristine" };
    }
  }

  try {
    const { installDemo } = await import("./service");
    const result = await installDemo.call({ publish: true }, { kind: "system" });
    console.log(
      `[freeholder] demo installed: ${result.business}, ${result.pages.length} pages, ${result.assets} images`,
    );
    return { status: "installed", ...result };
  } catch (error) {
    // A restart of a seeded process is not a fault. Match both the typed code
    // and this installer's precise refusal so an unrelated conflict — for
    // example a half-populated form slug — still stops an incomplete demo.
    if (
      error instanceof ServiceError &&
      error.code === "conflict" &&
      error.message.includes("already has pages")
    ) {
      console.log(`[freeholder] demo not installed: ${error.message}`);
      return { status: "already-populated" };
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[freeholder] demo installation failed: ${message}`);
    throw error;
  }
}
