// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Who did something, in words. Audit rows store actor ids such as
// `user:00d31fd0-…`; an owner reading a history list should never see one.
import type { Translate } from "@/core/i18n";
import { SEED_AUDIT_ACTOR } from "@/core/service";

export function actorLabel(
  actor: string,
  t: Translate,
  names?: ReadonlyMap<string, string>,
): string {
  const named = names?.get(actor.toLowerCase());
  if (named) return named;
  if (actor.startsWith("agent:")) return t("actor.agent", { name: actor.slice(6) });
  if (actor.startsWith("user:")) return t("actor.staff");
  if (actor === SEED_AUDIT_ACTOR) return t("actor.seed");
  if (actor === "system" || actor.startsWith("system:")) return t("actor.system");
  return t("actor.visitor");
}
