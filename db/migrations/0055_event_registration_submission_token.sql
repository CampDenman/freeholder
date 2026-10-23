-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C6.11: a public registration remembers the hash of the one-time token its
-- form carried, so only a repeat of that same submit (a double click, a
-- retried request) is answered with the registration it made. A stranger who
-- knows only the email gets no invoice link.
ALTER TABLE "event_registrations" ADD COLUMN "submission_token_hash" text;
