# Client deployment requirements

Readiness repair, 2026-09-21 (MASTER.md C1.03, C1.05, C6.08, C6.11,
C9.09, C9.12, C10.06, C10.10, C11.10).

Before exposing a fresh production instance, configure an independent random
`BOOTSTRAP_SECRET` of at least 32 characters in the deployment environment.
Generate one with `openssl rand -hex 32`, store it privately, and enter it in
the setup form. API setup callers supply `bootstrapSecret` alongside email and
password. Keep it in private deployment settings for subsequent recipe deployments;
existing users do not enter it at login. If you unset it, remove the variable
entirely instead of leaving an empty value in the environment.
Development and test instances without a configured secret retain local setup.

The deployment examples and scaffold require this secret. Render generates it;
retrieve it from the private environment settings before setup. The App Platform
spec preparation script requires it. Never put the generated secret in Git.

Public waitlist enrollment now returns only `{ "ok": true }`, including repeat
requests. Read entry IDs and status through authenticated waitlist services.
Referral touches may still use an anonymous visitor identifier, but binding a
contact requires that contact's signed-in user or explicit referral write scope.

Forms limit repeated validated submissions by signed-in user, explicitly trusted
proxy address, validated email, or identical answers. Invalid answers do not
consume another visitor's bucket. This application limit is not a network flood
defense. Configure edge request limits for public endpoints. Only configure
`TRUSTED_CLIENT_IP_HEADER` when the proxy overwrites the named header and direct
access to the application is blocked. Supported headers are
`x-freeholder-client-ip`, `cf-connecting-ip`, and `x-real-ip`. Client-supplied
forwarding headers are not trusted by default.

Free event registrations remain supported. Events with tickets require an active
ticket belonging to that event. Paid registrations are currently refused before
contact creation, reservation, or charging: payment settlement has not been
integrated. Reconcile any existing paid-event confirmations made by older builds
against actual payment records before admitting attendees.
Legacy paid or invalid ticket registrations are also blocked from automatic
promotion and check-in; verifying old payments does not enable the missing flow.

Automatic apply and rollback are disabled. Use [the operator update procedure](update-apply.md).
Previous update history and 64-byte snapshot fingerprints are not evidence of a
backup, a completed deployment, or successful rollback. Do not delete them as
part of this repair; retain them as historical records with that limitation.

Before client launch, exercise the site's enabled workflows on staging and
restore a real database backup into a separate database. Container/provider
deployment, email delivery, payment settlement, and restore tests must use the
actual target configuration. Local tests cannot certify those external systems.
