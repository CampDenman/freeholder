// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type {Check as DoctorCheck} from "@/core/doctor";
import type {getT} from "../../../i18n";
/**
 * A check that carries a catalog message, shown in the owner's language.
 * Literal keys, one per message, so the i18n gate can see every one of them.
 */
export function localized(
  check: DoctorCheck,
  t: Awaited<ReturnType<typeof getT>>,
): DoctorCheck {
  const params = check.message?.params ?? {};
  switch (check.message?.key) {
    case "doctor.probe.required":
      return {...check,detail:t("doctor.probe.passive"),remedy:t("doctor.probe.required")};
    case "doctor.pluginPermissions.review":
      return { ...check, title: t("doctor.pluginPermissions.title"), detail: t("doctor.pluginPermissions.review", params), remedy: t("doctor.pluginPermissions.remedy") };
    case "doctor.pluginTrust.failed":
      return { ...check, title: t("doctor.pluginTrust.title"), detail: t("doctor.pluginTrust.failed", params), remedy: t("doctor.pluginTrust.remedy") };
    case "doctor.timeZone.agree":
      return { ...check, title: t("doctor.timeZone.title"), detail: t("doctor.timeZone.agree", params) };
    case "doctor.timeZone.disagree":
      return {
        ...check,
        title: t("doctor.timeZone.title"),
        detail: t("doctor.timeZone.disagree", params),
        remedy: t("doctor.timeZone.disagreeRemedy", params),
      };
    case "doctor.timeZone.unknown":
      return {
        ...check,
        title: t("doctor.timeZone.title"),
        detail: t("doctor.timeZone.unknown", params),
        remedy: t("doctor.timeZone.unknownRemedy", params),
      };
    case "doctor.timeZone.unreadable":
      return {
        ...check,
        title: t("doctor.timeZone.title"),
        detail: t("doctor.timeZone.unreadable", params),
        remedy: t("doctor.timeZone.unreadableRemedy", params),
      };
    default:
      return check;
  }
}

