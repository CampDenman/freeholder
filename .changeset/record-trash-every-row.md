---
"freeholder": patch
"@freeholder/sdk": patch
---

<!-- Copyright (C) 2026 Tony Aly -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

C11.14: Pages, forms, popups, segments and saved views now move to recoverable trash, on the same guarantees notes and tasks shipped with (#381) through one shared factory. Removal keeps the original row and its identity — a trashed page holds its slug, submissions stay live while a form definition is in trash, and a trashed segment stops answering so popups, price lists, automations and messaging windows fail closed instead of widening. Restore returns the same record; permanent purge requires typed confirmation and recent identity verification, honours privacy retention holds on cascaded contact data, and a daily bounded sweep reclaims every family's thirty-day trash. The trash screen gains a tab per family with the records' existing view/manage (or ownership) grants, locales ship in en/fr/es, and the SDK/OpenAPI/MCP surfaces expose the new remove/restore/purge methods. Erasure still reaches evidence rows inside trash, and restoring never resurrects erased personal fields. Money ledgers, append-only evidence, credentials and never-deleted families are documented as deliberately not recoverable in `deploy/record-trash.md`.
