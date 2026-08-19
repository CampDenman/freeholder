# Migrate: Replit

Every Tier-1 move is the same archive:

1. `pnpm ownership:export` on the source.
2. Provision the target from its recipe.
3. Import the archive / restore the dump.
4. Sync the object-storage bucket.
5. Repoint DNS.

Pairs covered: Replit ↔ DigitalOcean App, Droplet, Railway, Render, Docker.
Expected downtime: minutes for DNS, not a data rewrite.
