---
"freeholder": patch
---
Self-hosting with Docker Compose now works from the launch preparation step, and can run over HTTPS. `pnpm launch:prepare --target docker-selfhost` writes its settings where Compose reads them (`deploy/docker-selfhost/.env`), generates the database password, no longer asks for a database address that Compose builds itself, and tells you the exact command to start. A new HTTPS Compose file puts Caddy in front with an automatic Let's Encrypt certificate, so owner passkeys work on a public server. Switching from the plain file to the HTTPS one keeps your data.
