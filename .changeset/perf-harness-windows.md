---
"freeholder": patch
---

The C11.11 performance harness now runs on Windows. It shelled out to `pnpm`,
which cannot work there: `spawnSync` finds no bare `pnpm` to execute, and naming
`pnpm.cmd` is refused outright with EINVAL because Node will not spawn a `.cmd`
without a shell. The harness therefore exited before measuring anything, which
matters because C11.11 asks the product owner for acceptance evidence and a gate
that only runs on the CI image cannot be the gate somebody signs. Vitest is now
run through Node directly, so no package manager is involved on any platform.
