# First stable release acceptance (C11.16/C11.17)

This is the release evidence procedure for MASTER.md §43, not a second backlog.
Stable remains unpublished and the independent review remains unchecked.

The build and publishers read `src/core/update/release-declaration.json`.
Set its exact version, channel, minimum upgrade version, schema risk, CVSS/severity,
manual steps and plugin API in the same reviewed change as all package versions.
Breaking releases must declare tested recovery instructions. A candidate such as
`1.0.0-rc.1` uses channel `edge`, npm tag `next`, a prerelease GitHub release,
and its full image version tag. It never takes stable/latest. The final version
requires every live MASTER checkbox completed and the owner's completion signature.

Before tagging, complete the protected main CI run for the exact commit.
Publication verifies that identity and promotes its already tested image digest.
The signed feed carries the same declaration; it never supplies compatible schema
risk or empty recovery steps on the build's behalf.

Run package verification from a clean checkout (`pnpm packages:verify`). It builds,
packs, installs and executes the packages outside the workspace. Registry publication
still requires ownership and write access to create-freeholder, freeholder-app and
@freeholder/{sdk,plugin-kit,templates,cli}. Configure the package workflow's NPM_TOKEN
privately or establish npm trusted publishing. Neither account access nor successful
public installation is proven by a local packed-artifact test.

Run the full C11.17 suite against the candidate and archive exact commit, image digest,
commands, pass/skip counts and configuration limitations. Exercise fresh bootstrap,
owner second-factor setup, page editing/publishing and customer journeys. Rehearse
upgrade and rollback with a recoverable database backup and actual object bytes;
retain checksums and verify restored content through the app before cutting over.
Existing media-row-only restore evidence does not prove object-byte recovery.

Provider acceptance follows deploy/commerce-payments.md, using actual enabled provider
configuration on an isolated instance. A manual receipt or mocked HTTP response
is not provider settlement. This environment's public production instance has no
configured provider credential environment variables; do not charge from it by guesswork.

The independent reviewer uses security/independent-review-packet.md. Automated
CodeQL and dependency checks are inputs to that review, not its signature.
Only the product owner signs the final C11.17 record after evidence is complete.
