// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The white-label customer app (MASTER.md §35, C10.12).
//
// §35.1's first rule, and the reason this package is shaped the way it is:
// "The app is a client, never a second implementation. Every screen calls the
// generated SDK (§28) against the instance's own API. There is no mobile-only
// endpoint, no mobile-only business rule, and no mobile-only notion of a
// customer. This is not tidiness: a rule that exists only in the app is a rule
// that stops being true the moment somebody uses the website instead, and the
// store review cycle means the app is always the copy that is weeks out of
// date."
//
// So what lives here is exactly the four things a client needs and the
// platform cannot supply: which instance to talk to, how to hold a session on
// a device, what to show with no signal, and what the brand looks like.
export {
  APP_CONTRACT_VERSION,
  discover,
  normalizeAddress,
  type DiscoveryResult,
  type Instance,
} from "./discovery.js";
export {
  SESSION_KEY,
  loadSession,
  saveSession,
  signIn,
  signOut,
  unlockOnResume,
  type BiometricGate,
  type SecretStore,
  type Session,
  type SignInResult,
} from "./session.js";
export {
  OfflineWriteRefused,
  cacheKey,
  freshnessLabel,
  readThrough,
  type Cache,
  type Freshness,
  type ReadResult,
} from "./offline.js";
export { brandFrom, type Brand } from "./branding.js";
export {
  SCREENS,
  SCREEN_IDS,
  TAB_ORDER,
  screensNeedingSignIn,
  servicesUsed,
  type ScreenAudience,
  type ScreenContract,
  type ScreenId,
} from "./screens.js";
export {
  APP_SCHEME,
  needsSignIn,
  pushLink,
  resolveDeepLink,
  type Destination,
  type Resolution,
} from "./deep-links.js";
