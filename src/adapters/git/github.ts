// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One GitHub client, for every lane that opens a pull request in the owner's
// own repository: §37's builder code proposals (C4.20) and §39.7's fork
// updates (C10.09).
//
// It lives in `adapters` because it is provider I/O at a swappable edge, and
// because two copies of an authenticated HTTP client is how one of them
// quietly stops redacting its token.
import { requestWithTimeout, providerJson } from "@/adapters/mail/http";
import { env } from "@/core/env";
import { ServiceError } from "@/core/service";

export interface RepositoryTarget {
  /** `owner/repo`, the owner's own fork. */
  repository: string;
  baseBranch: string;
}

/** Where a proposal would go, or `null` when no repository is connected. */
export function repositoryTarget(): RepositoryTarget | null {
  const repository = env().BUILDER_CODE_REPOSITORY;
  const token = env().BUILDER_CODE_TOKEN;
  if (!repository || !token) return null;
  return { repository, baseBranch: env().BUILDER_CODE_BASE_BRANCH ?? "main" };
}

export interface GitHubRequest {
  method: string;
  body?: unknown;
  /** Statuses to return rather than throw on, for calls whose failure is data. */
  allow?: readonly number[];
}

export interface GitHubResponse<T> {
  status: number;
  body: T | null;
}

/**
 * Call the GitHub REST API with the connected token.
 *
 * `allow` exists for one specific case: a merge that conflicts answers 409,
 * and a conflict is an answer this platform wants to report by file rather
 * than raise as a provider failure.
 */
export async function github<T>(
  path: string,
  init: GitHubRequest,
): Promise<GitHubResponse<T>> {
  const token = env().BUILDER_CODE_TOKEN;
  if (!token) {
    throw new ServiceError("conflict", "No repository is connected for code proposals.");
  }
  const response = await requestWithTimeout(
    globalThis.fetch,
    `https://api.github.com${path}`,
    {
      method: init.method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    },
  );
  if (init.allow?.includes(response.status)) {
    return { status: response.status, body: null };
  }
  return { status: response.status, body: await providerJson<T>(response, "GitHub") };
}

/** The common case: a call whose only acceptable outcome is a parsed body. */
export async function githubJson<T>(path: string, init: GitHubRequest): Promise<T> {
  const result = await github<T>(path, init);
  if (result.body === null) {
    throw new ServiceError("conflict", "GitHub returned no body for a call that requires one.");
  }
  return result.body;
}
