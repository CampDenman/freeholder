// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Expiring recipient download for an accounting export (C9.32).
import { requestMetadata } from "@/core/http/request-metadata";
import { ServiceError } from "@/core/service";
import { downloadExportForRecipient } from "@/modules/reporting/service";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  try {
    const file = await downloadExportForRecipient.call(
      { token },
      { kind: "anonymous", request: requestMetadata(request) },
    );
    const safe = file.filename.replace(/[\r\n"]/g, "").slice(0, 180) || "accounting-export.csv";
    return new Response(file.csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "cache-control": "private, no-store",
        "content-security-policy": "default-src 'none'; sandbox",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    if (error instanceof ServiceError) {
      const status = error.code === "rate_limited" ? 429 : 404;
      const headers = error.retryAfterSeconds
        ? { "retry-after": String(error.retryAfterSeconds) }
        : undefined;
      return Response.json(
        { error: status === 429 ? error.message : "That download link is invalid or has expired." },
        { status, headers },
      );
    }
    throw error;
  }
}
