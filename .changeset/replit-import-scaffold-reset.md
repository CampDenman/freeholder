---
"freeholder": patch
---

Launching on Replit is now documented as the two steps it actually takes. Replit's **Import from GitHub** runs an agentic importer that assumes an unfamiliar repository needs porting: on Freeholder it commits a `pnpm_workspace migration scaffold` that moves the whole project into `.migration-backup/` and replaces the checked-in `.replit` with a generated one naming `nodejs-24` and an `autoscale` deployment, dropping the PostgreSQL module and the port mapping the recipe depends on. Freeholder already ships a first-class `.replit` and `replit.nix`, so the fix is to import and then run `git reset --hard origin/main`, which restores the real recipe and leaves a clean tree. The Replit recipe and the README now say this up front, including what to check afterwards and why you should decline Replit Agent's offer to "set up" the project — there is nothing to port, and that paid agent run would only be undoing the importer.
