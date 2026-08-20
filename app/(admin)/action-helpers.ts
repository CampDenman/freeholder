// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Shared plumbing for admin server actions.

/**
 * A service message with its machine addressing removed.
 *
 * `defineService` prefixes a rejected input with the service name and the
 * failing path — `forms.update: fields: The field "x" is…` — which is right
 * for an API caller and noise above a text box. The sentence after it was
 * written for a person, so that is what an owner is shown.
 *
 * This helper existed as six identical private copies across the action
 * files before it was drawn together here. The general fix remains catalog
 * keys for service errors (the audit's batch-6 programme): until every
 * ServiceError message has a key in the locale catalogs, this at least keeps
 * the one transformation consistent and in one place.
 */
export function ownerFacing(message: string): string {
  return message.replace(/^[a-z][\w.]*: (?:[\w.[\]]+: )?/, "");
}
