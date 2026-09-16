# packages/ — pre-release distributable packages

Freeholder-authored packages use Apache-2.0 and each packed artifact carries
the same `LICENSE` as the repository root. The packages build, pack, install and execute outside the workspace. A
`vX.Y.Z` tag publishes them to the public registry at the same version health,
admin, Doctor and the contract report. See the root `LICENSING.md` for the
full policy.

`@freeholder/sdk` is the typed HTTP client generated from the live service
registry.
`create-freeholder` scaffolds verified source, checks the generated
environment, can install dependencies and run migrations, and prints a setup
URL with reachable-or-recovery guidance.
`@freeholder/templates` ships creator, service-business and shop presets with
Bench tokens and full page, entity and email trees; `seed.installPreset`
installs them through CMS, catalog and design services.
`@freeholder/plugin-kit` is the plugin authoring contract (C3.08–C3.12).
`@freeholder/cli` installs the `freeholder` binary: `freeholder update
--check | --preflight | --apply | --rollback`, with exit codes fit for cron
and monitoring (C10.21). It is a client of an instance's own API, not a second
implementation of the updater.
`freeholder-app` installs `npx freeholder-app init`: point it at an instance
URL and it pulls branding, writes icons/splash/store metadata/screenshots and
prints an auditable `app.json` / `eas.json` diff (C10.15). CI exports iOS and
Android against the demo contract and fails on an unparsable document, a
missing init asset, or a privacy-manifest mismatch (C10.16). Signed store
binaries still need EAS credentials.
`@freeholder/mobile-app` is the white-label customer app's client layer —
instance discovery, keychain sessions, read-through-write-never offline state
and runtime branding (C10.12). The screens themselves are C10.13, so this is
not yet an app you can submit to a store.
