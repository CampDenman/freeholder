# Licensing

Freeholder-authored code and documentation are licensed under the
**Apache License 2.0** (`Apache-2.0`). The authoritative license text is in
[`LICENSE`](LICENSE).

This includes the platform, web application, admin, modules, SDK, deploy
tooling, templates, and the separately published packages under `packages/*`.
Each published package carries a copy of the same license text.

Copyright (C) 2026 Tony Aly. Freeholder was created, originally authored, and
is owned and maintained by Tony Aly ([tonyaly.com](https://tonyaly.com),
`tony@paradisemodern.com`). The repository is hosted under the `CampDenman`
GitHub organization; that is where the code lives, not a separate rights
holder.

## What Apache-2.0 permits

Apache-2.0 is a permissive open-source license. It permits use, modification,
distribution, sublicensing, and commercial use, subject to the conditions in
the license text. It also includes an express patent grant from contributors.

Redistributors must provide a copy of the license, retain applicable notices,
and mark modified files as changed. The license does not grant rights to use
Freeholder names or trademarks beyond describing the work's origin.

Versions previously released under AGPL-3.0-only or MIT remain available under
the terms under which they were received. This change applies to the repository
and releases from this change forward.

## SPDX identifier

Package manifests declare `Apache-2.0`. New Freeholder-authored source files
carry this header, using the file type's comment syntax:

```
// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
```

Run `pnpm license:check` to verify source headers, manifest declarations, and
the license texts shipped with packages.

## Third-party material

Third-party dependencies and bundled assets remain under their own licenses.
For example, the bundled font files retain their SIL Open Font License notices
under `public/fonts/`. Apache-2.0 does not replace or remove those notices.

## Contributions

Contributions are accepted under Apache-2.0 (inbound = outbound), certified
via the [Developer Certificate of Origin](DCO.md) with a `Signed-off-by` line.
There is no CLA or copyright assignment; contributors retain copyright in
their contributions.

## Questions

If you are unsure how the license applies to your use case, open a Discussion.
Nothing in this plain-English summary is legal advice; the `LICENSE` text is
authoritative.
