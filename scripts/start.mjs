// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Next must know that Freeholder owns SIGINT/SIGTERM before its CLI installs
// the default handlers. instrumentation.node.ts then drains pg-boss and exits.
process.env.NEXT_MANUAL_SIG_HANDLE = "true";
process.argv.splice(2, 0, "start");
await import("next/dist/bin/next");
