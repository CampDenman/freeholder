# Release channels

An update is only as honest as the metadata that describes it. Freeholder
does not infer “this is a patch, so it is safe” from a version number.

| Channel | What it carries |
|---|---|
| `stable` | Patch and minor releases. The default. |
| `security` | Security-only patches, backported to the current and previous minor. |
| `edge` | `main`. For contributors and freeholder.ai itself. |

An instance subscribed to `stable` also receives `security`. An instance
subscribed to `security` receives only that channel. `edge` receives
everything.

Every release declares, in machine-readable form:

- **minFromVersion** — the earliest version it can be applied from
- **schemaRisk** — `compatible` or `breaking`
- **CVSS** and **severity** — a score where a CVE applies, otherwise neither
- **manualSteps** — an empty list when none are required
- **pluginApi** — the plugin-API version this release ships

`platform.describeRelease` reports this build’s declaration. Doctor checks
`update.channel` and `update.release`. The signed feed that publishes these
records is C10.03; this document is not a claim that unattended self-update
is already running.
