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
  DEVICE_TOKEN_KEY,
  loadSession,
  saveSession,
  signIn,
  completeTwoFactorSignIn,
  redeemSignInLink,
  resolveSessionRole,
  sessionAudience,
  isStaffRole,
  signOut,
  saveDeviceToken,
  loadDeviceToken,
  clearDeviceToken,
  unlockOnResume,
  type BiometricGate,
  type SecretStore,
  type Session,
  type SessionAudience,
  type SignInResult,
  type TwoFactorMethods,
} from "./session.js";
export {
  OfflineWriteRefused,
  cacheKey,
  freshnessLabel,
  readThrough,
  PRIVATE_CACHE_LEASE_MS,
  isAccessDenied,
  writeThrough,
  type Cache,
  type Freshness,
  type ReadResult,
} from "./offline.js";
export { revocableCache, encryptedCache, privateCacheScope, noCache, type CacheStorage } from "./private-cache.js";
export { discoverWithCache, rememberInstance } from "./cached-discovery.js";
export { serviceResponse } from "./transport.js";
export { brandFrom, type Brand } from "./branding.js";
export { appText } from "./strings.js";
export { formatMoney } from "./format.js";
export {
  SCREENS,
  SCREEN_IDS,
  TAB_ORDER,
  OWNER_TAB_ORDER,
  tabOrderFor,
  tabFileName,
  screensNeedingSignIn,
  staffScreens,
  customerSignedInScreens,
  servicesUsed,
  type ScreenAudience,
  type ScreenContract,
  type ScreenId,
} from "./screens.js";
export {
  CAPTURE_SOURCES,
  openCaptureSession,
  ingestCaptureUpload,
  confirmCaptureSession,
  type CaptureSource,
  type CaptureSession,
  type CaptureTransport,
} from "./capture.js";
export {
  APP_SCHEME,
  needsSignIn,
  pushLink,
  resolveDeepLink,
  type Destination,
  type Resolution,
} from "./deep-links.js";
