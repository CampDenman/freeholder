# Customer locale operations

Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: AGPL-3.0-only

Freeholder uses one locale contract for every customer surface. Public and
anonymous portal requests follow an explicit URL prefix; after customer
sign-in, the linked `Contact.preferred_locale` wins; a missing or disabled
preference falls back to the business default. The default locale is
unprefixed and every other enabled locale uses `/<locale>/...`.

## Configure and verify languages

The business default must also be present in its enabled locale list. Adding a
locale makes it available in public and portal choosers; it does not silently
machine-translate owner content.

For each enabled non-default locale:

1. Open **Admin → Chrome** and choose **Add _language_** for the header and
   footer. Freeholder copies the source block tree into an independent,
   owner-editable locale row.
2. Translate owner-authored navigation labels and footer copy, then preview
   the exact locale before saving.
3. Review page translations in **Admin → Translations**. Only reviewed page
   translations are advertised through `hreflang`; missing content falls back
   to the source page rather than producing a partial 404.
4. Visit the default and prefixed public URLs. Follow brand, navigation,
   button, location and form-submit paths and confirm the selected locale is
   retained.

If a translated chrome row is still missing, the complete source header or
footer is rendered as a fallback. It never disappears around a translated
page. The setup seed and migration add the locale chooser as a real CMS block,
so an owner can place and style it with the rest of the chrome.

## Portal, templates and notifications

Anonymous portal language links change the URL, not the Contact. A stored
Contact preference still wins for the magic-link template. On first use, when
no preference exists, the selected enabled locale is held only on the
short-lived hashed-token row; it becomes the Contact preference after the
customer proves control by consuming that token. Merely knowing somebody's
email therefore cannot rewrite their profile. The link carries the same prefix
through the scanner-safe confirmation screen.

After sign-in, choosing a language updates the linked Contact through the
audited service layer and records `contact.localeChanged` on the timeline. The
next portal render, customer template and notification uses that fact.
Disabled or malformed stored tags never escape onto a customer surface.

Notifications snapshot the resolved locale beside the title, body and action
link. Catalog-key messages render before commit; email boilerplate, occurrence
copy and digest subject/introduction render from that snapshot. Digests group
by recipient and locale, so a preference change cannot mix two languages in
one message. Literal owner-authored content remains literal and is not
pretended to be translated.

## Migration and rollback

`0034_furry_ozymandias.sql` and `0035_slim_wiccan.sql` are additive. They add
notification/digest locale snapshots and the short-lived magic-link locale
handoff, backfill existing notifications from an enabled Contact preference or
the business default, and append a locale chooser only to header block trees
that do not already contain one. They do not overwrite an existing chooser or
create hidden layout markup.

The previous application image ignores the added columns and the recognized
`locales` block type already existed before this migration, so N-1 remains
read/write compatible after forward migration. Rollback is an image swap; do
not remove the columns or rewrite section JSON merely to disable a locale.

Verification after deploy:

1. Run migrations and `pnpm doctor`.
2. Open one non-default public page and the customer login route with its
   prefix; neither portal request should create analytics visitor cookies.
3. Send a magic link to a test Contact with a non-default preference and
   inspect the language and prefixed URL at the development/approved test sink.
4. Create a test Contact notification and verify its `locale`, localized
   action path, delivery row and digest row without exposing message bodies in
   production logs.
