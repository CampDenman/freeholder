// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Full contract for assistants (MASTER.md §28, C3.06).
import { llmsContractSection } from "@/core/contract/projections";
import { ready } from "@/core/runtime";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  await ready();
  return new Response(llmsContractSection(), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
