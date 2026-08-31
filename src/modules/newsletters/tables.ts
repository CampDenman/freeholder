// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
export { newsletterIssues, newsletterSubscriptions, newsletters } from "./schema";
// One template model for every kind of message (§30, C9.05). It lives with
// newsletters because that is where §30 puts it, and because a newsletter
// issue is the first thing that reaches for one.
export { emailTemplates } from "./template-schema";
