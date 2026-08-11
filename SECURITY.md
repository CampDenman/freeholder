# Security Policy

Freeholder handles real businesses' customer data, payments, and mail
credentials. Security reports are taken seriously and handled with priority.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately via GitHub's **"Report a vulnerability"** button on this
repository's Security tab (private vulnerability reporting), or by email to
**tony@paradisemodern.com** with the subject line `[SECURITY] Freeholder`.

Include what you can: affected component, reproduction steps, impact
assessment, and any suggested fix. You will get an acknowledgement within
72 hours.

## Scope

The Freeholder core application (`app/` and `src/` at the repository root),
the packages under `packages/`, and the deployment templates in this
repository.

## Supported versions

Pre-alpha: only the `main` branch is supported. A versioned support policy
will land with the first release.

## Account recovery and two-factor keys

Roles that can manage roles, invitations, API keys, or connected credentials
must enrol two-factor authentication before their module grants become usable.
TOTP seeds are encrypted at rest, recovery codes and login challenges are
hashed, WebAuthn requires user verification, and critical credential/authority
changes require a factor proof no more than ten minutes old.

Keep `SESSION_SECRET` stable and backed up with the rest of the deployment
secrets. Changing it invalidates sessions, API keys, pending auth links, TOTP
seeds, and recovery codes. If the owner loses every factor or that secret is
unavailable, use the explicit break-glass command from the application image:

```sh
node scripts/owner-password.mjs --disable-2fa
```

Run the printed SQL against Freeholder's database, sign in with the one-time
password, and immediately enrol new factors from **Security**. The flag clears
only the owner's factor credentials and sessions; it never deletes business or
customer data.
