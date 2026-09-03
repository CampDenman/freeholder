// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Built-in social networks (MASTER.md §33, C9.24).
//
// Eight adapters, one factory. URLs and scope names change per vendor; the
// profile table and the admin screen do not. YouTube and Google Business
// Profile share the platform's Google OAuth client (different scopes), and
// Instagram and Facebook share the Meta client, because that is how those
// vendors actually issue apps.
import { env } from "@/core/env";
import { createSocialNetwork, nestedRecord, recordField } from "./factory";
import type { SocialIdentity } from "./types";

function requireId(body: unknown, ...keys: string[]): SocialIdentity {
  const nested = nestedRecord(nestedRecord(body, "data"), "user");
  const data = nestedRecord(body, "data");
  const id =
    recordField(body, ...keys) ??
    recordField(data, ...keys) ??
    recordField(nested, ...keys);
  if (!id) {
    throw new Error("The provider did not identify the account.");
  }
  const displayName =
    recordField(body, "name", "displayName", "display_name", "username") ??
    recordField(data, "name", "username", "display_name") ??
    recordField(nested, "display_name", "username") ??
    id;
  const handle =
    recordField(body, "username", "handle", "uniqueId") ??
    recordField(data, "username", "handle") ??
    recordField(nested, "username") ??
    null;
  return { providerAccountId: id, displayName, handle };
}

const google = {
  clientId: () => env().GOOGLE_OAUTH_CLIENT_ID,
  clientSecret: () => env().GOOGLE_OAUTH_CLIENT_SECRET,
};

const meta = {
  clientId: () => env().META_OAUTH_CLIENT_ID,
  clientSecret: () => env().META_OAUTH_CLIENT_SECRET,
};

export const instagram = createSocialNetwork({
  id: "instagram",
  label: "Instagram",
  authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
  tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
  identityUrl: "https://graph.instagram.com/v21.0/me",
  scopes: [
    "instagram_business_basic",
    "instagram_business_content_publish",
    "instagram_business_manage_comments",
  ],
  extras: ["posts", "comments", "stories"],
  ...meta,
  parseIdentity: (body) => requireId(body, "id"),
});

export const facebook = createSocialNetwork({
  id: "facebook",
  label: "Facebook",
  authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
  tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
  identityUrl: "https://graph.facebook.com/v21.0/me",
  scopes: [
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_posts",
    "pages_manage_engagement",
  ],
  extras: ["posts", "comments"],
  ...meta,
  parseIdentity: (body) => requireId(body, "id"),
});

export const tiktok = createSocialNetwork({
  id: "tiktok",
  label: "TikTok",
  authorizeUrl: "https://www.tiktok.com/v2/auth/authorize/",
  tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
  identityUrl: "https://open.tiktokapis.com/v2/user/info/",
  scopes: ["user.info.basic", "video.list", "video.upload"],
  extras: ["videos", "posts"],
  clientId: () => env().TIKTOK_OAUTH_CLIENT_ID,
  clientSecret: () => env().TIKTOK_OAUTH_CLIENT_SECRET,
  parseIdentity: (body) => requireId(body, "open_id", "id"),
});

export const youtube = createSocialNetwork({
  id: "youtube",
  label: "YouTube",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  identityUrl: "https://openidconnect.googleapis.com/v1/userinfo",
  scopes: [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/youtube.upload",
  ],
  extras: ["videos"],
  extraAuthParams: { access_type: "offline", prompt: "consent" },
  ...google,
  parseIdentity: (body) => requireId(body, "sub", "id"),
});

export const linkedin = createSocialNetwork({
  id: "linkedin",
  label: "LinkedIn",
  authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
  tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
  identityUrl: "https://api.linkedin.com/v2/userinfo",
  scopes: ["openid", "profile", "w_member_social"],
  extras: ["posts"],
  clientId: () => env().LINKEDIN_OAUTH_CLIENT_ID,
  clientSecret: () => env().LINKEDIN_OAUTH_CLIENT_SECRET,
  parseIdentity: (body) => requireId(body, "sub", "id"),
});

export const x = createSocialNetwork({
  id: "x",
  label: "X",
  authorizeUrl: "https://twitter.com/i/oauth2/authorize",
  tokenUrl: "https://api.twitter.com/2/oauth2/token",
  identityUrl: "https://api.twitter.com/2/users/me",
  scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
  extras: ["posts"],
  pkce: true,
  clientId: () => env().X_OAUTH_CLIENT_ID,
  clientSecret: () => env().X_OAUTH_CLIENT_SECRET,
  parseIdentity: (body) => requireId(body, "id", "username"),
});

export const pinterest = createSocialNetwork({
  id: "pinterest",
  label: "Pinterest",
  authorizeUrl: "https://www.pinterest.com/oauth/",
  tokenUrl: "https://api.pinterest.com/v5/oauth/token",
  identityUrl: "https://api.pinterest.com/v5/user_account",
  scopes: ["user_accounts:read", "pins:read", "pins:write"],
  extras: ["posts"],
  clientId: () => env().PINTEREST_OAUTH_CLIENT_ID,
  clientSecret: () => env().PINTEREST_OAUTH_CLIENT_SECRET,
  parseIdentity: (body) => requireId(body, "id", "username"),
});

export const googleBusiness = createSocialNetwork({
  id: "google_business",
  label: "Google Business Profile",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  identityUrl: "https://openidconnect.googleapis.com/v1/userinfo",
  scopes: ["https://www.googleapis.com/auth/business.manage"],
  extras: ["posts", "hours", "reviews", "locations"],
  extraAuthParams: { access_type: "offline", prompt: "consent" },
  ...google,
  parseIdentity: (body) => requireId(body, "sub", "id"),
});

export const BUILTIN_SOCIAL_NETWORKS = [
  instagram,
  facebook,
  tiktok,
  youtube,
  linkedin,
  x,
  pinterest,
  googleBusiness,
] as const;
