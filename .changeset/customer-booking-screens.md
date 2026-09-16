---
"freeholder": patch
"@freeholder/mobile-app": minor
"@freeholder/sdk": minor
---

Add customer-owned booking links and native booking list/detail screens with rescheduling, cancellation confirmation, and intake/waiver web handoffs (C10.25). Never expose management credentials in owner lists or cache booking links. Align the Expo native dependencies and verify Android/iOS bundles in CI.

Connect native password and email-link sign-in to the real auth services, accept validated user-session bearer credentials, and prevent invalid authorization headers from falling back to browser cookies. Cookie-bearing writes retain CSRF protection.
