---
"freeholder": patch
---
Publish 0.2.0-beta.5, the first beta you can install by hand on your own server without Docker or an AI assistant. The release carries a Linux tarball for x86_64 and arm64 with its own Node.js runtime, its SHA-256, and `install.sh`: on a fresh Ubuntu or Debian server, `sudo sh install.sh` sets up PostgreSQL, HTTPS and nightly backups and prints your claim link. The Docker Compose recipe now defaults to this release's image instead of `edge`. It also carries everything merged since 0.2.0-beta.4. It is still active development, not a release candidate; live provider acceptance and the independent security review remain open.
