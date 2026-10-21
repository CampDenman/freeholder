// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { getT } from "../../i18n";

export function securityLabels(t: Awaited<ReturnType<typeof getT>>, count: number) {
  return {
          ...Object.fromEntries([
            "downloadCodes", "requiredReady", "requiredMissing", "saved", "saveCodes", "authenticator",
            "authenticatorIntro", "enrolled", "notEnrolled", "remove", "setUpAuthenticator",
            "manualSecret", "code", "confirm", "keys", "keysIntro", "addKey", "defaultKeyName",
            "keyFailed", "keyName", "keyNameHint", "recovery", "verifyFirst", "regenerate",
            "sessions", "sessionsIntro", "currentSession", "lastSeen", "expires", "network",
            "unknownNetwork", "signOutSession", "signOutOthers", "signOutOthersIntro",
            "loginActivity", "loginActivityIntro", "noLoginActivity", "newDevice",
            "newNetwork", "noticeSent", "noticePending", "noticeUnavailable", "noticed",
          ].map((key) => [key, t(`security.${key}`)])),
          // ICU placeholders are resolved on the server. Passing the raw
          // catalog entry to the client used to make this page throw before a
          // newly registered owner could enrol their required second factor.
          recoveryIntro: t("security.recoveryIntro", {
            count: count,
          }),
        };
}
