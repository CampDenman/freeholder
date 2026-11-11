# OpenMLS binding (C12.39)

This thin client binding runs the same MLS implementation in the browser and
the Node-only KeyPackage validator. Rust is needed to regenerate the committed
runtime assets, never to deploy Freeholder. The binding accepts bounded JSON
and returns fixed error codes; private key/package/group snapshots remain in
the originating device's local store and never enter the delivery API.

`MASTER.md` §43 is the status authority. This source work does not supply the
independent C11.10 review or a stable-release sign-off. The member warning about
a compromised server remains: switching libraries does not authenticate a
device directory supplied by that server.

## Provenance and dependency review

The [official OpenMLS revision
6100df3fb1d8c3eeab53e349fcbd621f98c44fe2](https://github.com/openmls/openmls/tree/6100df3fb1d8c3eeab53e349fcbd621f98c44fe2)
is pinned for OpenMLS, traits, credentials and the RustCrypto provider.
The published provider 0.6.0 still pulls crypto-bigint 0.5.5, affected by
[RUSTSEC-2026-0387](https://rustsec.org/advisories/RUSTSEC-2026-0387.html).
The official upstream revision migrates to the patched RustCrypto generation
and HPKE 0.8.0; no local cryptographic primitive fork or advisory waiver is used.
Cargo.lock pins the complete dependency graph. OpenMLS's historical SRLabs
audit is not an audit of this revision or Freeholder's integration.

The 2026-11-11 RustSec run reports zero vulnerabilities. It also reports
[RUSTSEC-2026-0173](https://rustsec.org/advisories/RUSTSEC-2026-0173.html), an
informational maintenance warning for proc-macro-error2. That dependency occurs
only under hax's `cfg(hax)` verification tooling; it is absent from the compiled
wasm32 dependency tree. The warning is left visible, with no advisory ignored.
CI fails on vulnerabilities and unsoundness; this informational warning does
not become a fictional patched version.

Generated assets, full third-party notices, exact dependency sources and
unmodified MPL-2.0 HPKE source archives live together in
`public/_freeholder/openmls/0.1.0/`. Their manifest records every artifact hash
and the exact binding/build/lockfile inputs. Redistributors must keep them
together. The build refuses unknown Git sources or missing license texts.

## Regeneration

Use the pinned Rust 1.99.1 toolchain with wasm32-unknown-unknown, Node 20.19+
and wasm-bindgen-cli 0.2.130:

```sh
rustup toolchain install 1.99.1 --profile minimal --component rustfmt --target wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.130 --locked
node native/openmls/build.mjs
node native/openmls/build.mjs --check
cargo fmt --manifest-path native/openmls/Cargo.toml --all -- --check
cargo test --manifest-path native/openmls/Cargo.toml --locked
node native/openmls/interop.mjs
cargo install cargo-audit --version 0.22.2 --locked
cargo audit --file native/openmls/Cargo.lock --deny unsound
```

`CARGO` and `WASM_BINDGEN` can select explicit executable paths. `CARGO_HOME`,
`RUSTUP_HOME` and `CARGO_TARGET_DIR` retain their standard meanings. The build
sets a fixed source date, disables incremental output and remaps checkout and
Cargo paths so independently located checkouts produce identical bytes.

The native tests cover signature and KeyPackage validation, last-resort reuse
across conversations, pending receipt proof, snapshot/device/group substitution,
sender ratchet persistence/replay, stale epochs, unentitled-device refusal,
removal/rekey and privately retained erased-device history pins. The Node
interop proof uses freshly generated synthetic identities to migrate an existing
legacy two-device group, preserve identity keys, and exercise signatures and
HPKE history in both library directions. Application/browser suites qualify
delivery, persistence and the real UI separately.
