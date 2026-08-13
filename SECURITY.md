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

## Dependency vulnerability policy

`pnpm dependency:audit` checks the complete workspace lockfile against the
package registry advisory database. It runs on every pull request and every
push to `main`. High and critical advisories are absolute failures: they cannot
be waived. An actionable advisory at any severity is patched immediately,
using a narrowly scoped transitive override when the direct maintainer has not
yet moved its dependency floor.

Info, low or moderate findings may remain only when no compatible fix exists
and the affected path is not currently exploitable. Each such decision must be
recorded in `security/dependency-audit-exceptions.json` with:

- the GHSA identifier, package, severity and every dependency path reported by
  pnpm;
- a named owner, concrete reachability/impact reason and remediation plan;
- review and expiry dates no more than 90 days apart.

The gate rejects missing paths, expired or duplicate exceptions, severity or
package drift, stale entries after an advisory disappears, and any attempt to
except a high/critical finding. Renewing an exception is a fresh security
review in a pull request, not a date-only edit. The ledger is currently empty:
there are no accepted dependency advisories.

Dependabot checks the pnpm workspace weekly. When an advisory appears, use
`pnpm why <package> -r` to enumerate paths, prefer the smallest compatible
direct update, and use a parent-scoped override only when that keeps unrelated
dependency majors untouched. After updating the lockfile, run:

```sh
pnpm dependency:audit
pnpm test
pnpm build
```

Remove a security override once every parent naturally requires a patched
release; the audit gate proves the lockfile remains safe without it.

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

## Sessions, devices, and login notices

Every signed-in person can review and revoke their own active sessions from
**Security**. Revoking all other sessions requires a two-factor proof no more
than ten minutes old; revoking one suspicious session remains immediately
available. Password changes continue to revoke every other session as well.

Freeholder does not retain full IP addresses. The HTTP boundary reduces the
deployment proxy's address to a masked network hint and HMAC comparison key;
user agents are sanitized and capped at 512 characters. Detailed metadata
exists only on an active session, whose sliding expiry is 30 days and whose
row is deleted immediately on expiry or revocation.
Successful-login history retains only coarse device labels, masked network
hints, and HMACs for 90 days, after which a scheduled job deletes it.

After the first metadata-bearing login establishes a baseline, a new device or
a familiar device on a new network creates a visible security notice and queues
transactional email. Login never depends on mail uptime: failed delivery is
shown in the security history and retried up to five times. These are useful
signals, not geolocation or proof of compromise; forwarding headers must be
replaced by the deployment's trusted proxy as documented in its recipe.

## Customer magic links

Customer sign-in starts only from an email already held by the single Contact
spine. The request response does not reveal whether that Contact exists. The
raw token is sent by mail and never stored; Freeholder stores a keyed hash, a
snapshot of the proven email, a 15-minute expiry, and one-use state. Changing
the Contact email or merging away that Contact invalidates the link.

Following a link performs no authentication. The GET removes the credential
from the URL and stages it in an HttpOnly, SameSite=Strict cookie scoped to the
confirmation path; a deliberate POST consumes it. This prevents ordinary mail
security scanners from spending a customer's link. Successful proof links one
passwordless customer User to the existing Contact, rather than creating a
second customer identity. Any role with stored module grants is categorically
ineligible for magic-link login and must use the staff authentication flow.
