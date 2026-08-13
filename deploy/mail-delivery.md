# Mail delivery and feedback

Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0

Freeholder has two deliberately separate routes:

- **Account mail** sends password resets, portal links, staff invitations,
  security notices and form notifications through Gmail, Microsoft Outlook or
  SMTP.
- **Broadcast mail** sends campaigns through Resend, Postmark or Amazon SES.
  It never falls back to Gmail, Outlook or SMTP because broadcasts require
  authenticated bounce/complaint feedback and local suppression state.

The database keeps sender state, recipient, subject, provider reference,
timestamps and normalized delivery status. It never keeps message bodies or
raw webhook payloads. Raw provider payloads are authenticated in memory and
represented only by a SHA-256 digest.

## Account mail

### Google delegated Gmail

1. Create an OAuth web application in the Google project you already control.
2. Add this exact redirect URI:

   ```text
   ${APP_URL}/api/mail/oauth/google/callback
   ```

3. Set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` and
   `CREDENTIAL_KEY`.
4. Restart Freeholder. Open **Admin → Settings → Mail**, choose **Connect
   Google**, approve only the displayed identity and `gmail.send` scopes, then
   choose the connected sender as default.

Freeholder requests offline access so it can send account mail after the
interactive session ends. Access and refresh tokens are encrypted with
`CREDENTIAL_KEY`. Losing that key means reconnecting the mailbox; include it
in the same protected backup set as the database.

### Microsoft delegated Outlook

1. Create an Entra ID application for the tenant policy you use.
2. Add this exact redirect URI:

   ```text
   ${APP_URL}/api/mail/oauth/microsoft/callback
   ```

3. Grant delegated `Mail.Send` plus the identity/offline scopes shown during
   consent. Freeholder does not request mailbox read access.
4. Set `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET`, optional
   `MICROSOFT_OAUTH_TENANT` (default `common`) and `CREDENTIAL_KEY`.
5. Restart, connect from **Admin → Settings → Mail**, and choose the sender as
   default.

An `invalid_grant` refresh response marks the account for reconnection in an
independent transaction, so that evidence survives the failed send. Network,
429 and 5xx failures keep the account active for retry.

### SMTP

Set:

```dotenv
MAIL_ADAPTER=smtp
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
MAIL_FROM="Business name <hello@example.com>"
```

Restart, then register the exact normalized `MAIL_FROM` address in **Admin →
Settings → Mail**. SMTP configuration proves only that a transport is
configured. It does not prove domain ownership, SPF, DKIM, DMARC or inbox
placement; use **Send test** to your own account and confirm those records with
the mailbox provider.

## Broadcast carriers

Set `MAIL_BULK_ADAPTER` to `resend`, `postmark` or `ses`, set
`MAIL_BULK_FROM`, and provide the selected carrier's existing credentials from
`.env.example`. Restart, register the exact `MAIL_BULK_FROM`, run provider
verification, and choose the verified sender as the bulk default. Freeholder
does not provision a paid account or make a billable campaign send during
setup or doctor.

### Resend feedback

Set `RESEND_WEBHOOK_SECRET` and point the Resend webhook at:

```text
${APP_URL}/api/mail/webhooks/resend
```

Freeholder checks the Svix message id, timestamp (five-minute tolerance) and
every `v1` signature in the rotation header against the unmodified bounded
request body. The stable Svix id makes replay idempotent.

### Postmark feedback

Generate a dedicated high-entropy Basic Auth username and password, set
`POSTMARK_WEBHOOK_USER` and `POSTMARK_WEBHOOK_PASSWORD`, and configure each
Postmark delivery/bounce/complaint/subscription webhook to:

```text
${APP_URL}/api/mail/webhooks/postmark
```

The credential comparison is constant-size and timing-safe. Postmark provider
reactivation is recorded but never silently releases Freeholder's local
suppression; an authorized person must type the exact address to release it.

### Amazon SES through SNS

1. Configure the SES configuration set named by `SES_CONFIGURATION_SET` to
   publish send, delivery, delay, bounce, complaint, reject and rendering
   events to one SNS topic.
2. Set the topic's exact ARN in `SES_SNS_TOPIC_ARN`.
3. Subscribe this HTTPS endpoint:

   ```text
   ${APP_URL}/api/mail/webhooks/ses
   ```

4. Allow Freeholder to confirm the signed subscription request.

Only the exact topic is accepted. Header and payload topic/type must agree.
Signing and confirmation URLs must be HTTPS SNS hosts with no credentials,
nonstandard port or redirect. Signing certificates are bounded, cached for at
most 24 hours, valid for `sns.amazonaws.com`, Amazon-labelled, current and RSA
2048-bit or stronger. Only SNS `SignatureVersion` **2** with RSA-SHA256 is
accepted; SHA-1/Version 1 is refused. HTTPS verifies the AWS server chain
before the message-supplied signing certificate is read from the strict AWS
hostname/path.

## Suppression and operations

Permanent bounces, complaints and provider suppressions activate an exact,
lowercase address suppression before another send can reach a provider. Soft
bounces do not. Provider events use provider occurrence time and a
non-regressive transition graph, so a late submitted/failed/delivery message
cannot undo a complaint or suppression.

Use **Admin → Settings → Mail** to inspect senders, recent delivery evidence
and suppressions. Release only after correcting or independently verifying the
address, and type the exact address into the release form. A provider saying
it reactivated an address is evidence, not authority to bypass this check.

Run `pnpm doctor` after every setup or credential rotation. It reports
configured, pending, missing and reconnect states, the exact authenticated
feedback URL, and remediation variable names without rendering secret values
or sending mail.

## Threat model and verification

The relevant threats are replayed/forged feedback, SSRF through SNS URLs,
unbounded bodies/certificates/provider responses, OAuth state theft or replay,
provider-account reassignment, credential leakage, out-of-order events,
accidental personal-mailbox broadcasts, and unsafe suppression release. The
implementation closes these at the HTTP, transaction and schema boundaries.

Before relying on mail in production:

1. Run `pnpm doctor` and resolve every mail failure.
2. Send one account-mail test to the signed-in administrator and verify its
   inbox and headers.
3. Verify the broadcast identity with the provider, then use the single-recipient
   test control. Do not use a campaign list for setup validation.
4. Trigger provider sandbox/test delivery feedback where available and confirm
   the ledger updates. Never use a real customer address for a bounce test.
5. Confirm an intentionally malformed or replayed provider payload is refused
   without raw detail in the response or database.

Migration `0031_lucky_maria_hill.sql` is additive: it creates only the five
mail tables, constraints, indexes and foreign keys. Release N-1 does not know
about them and remains read/write compatible after the forward migration, so
rollback is an image swap. Do not drop the tables to disable mail; set the
adapters to `console`/`none` and pause registered senders instead.
