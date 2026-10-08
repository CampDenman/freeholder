---
"freeholder": patch
"@freeholder/sdk": patch
"@freeholder/mobile-app": patch
---

C8.03/C8.04/C8.07/C8.11/C8.13/C8.17/C11.10: block private gallery originals and stale ZIPs from bypassing access, watermark, guest and download rules. Byte authorization stays behind controlled gallery routes; old ZIPs require rebuilding. Customer list queries no longer disclose unsent quotes, draft invoices/documents, staff notes or unpublished case-study copy. Password resets are atomically single-use and invalid tokens cannot exhaust another link's allowance (B03). These adversarial repairs do not complete the independent security review.

Gallery byte-authorizer services are internal; gallery session responses expose `viewUrl`, permitted `downloadUrl` and `archiveUrl` for controlled delivery. These routes accept the session token in `Authorization: Bearer <sessionToken>` or the browser cookie, without printing it in a URL. Migration 0023 marks existing client-gallery assets private. Object storage must also be private: these application checks cannot revoke previously delivered copies or signed URLs, or repair a publicly readable bucket.

Client-gallery privacy applies to every use of the same asset, including public media and published project views. Migration 0023 also makes previously shared gallery assets private. Removing a file from its gallery does not automatically make it public again; use a separate public asset for public presentation with the required consent.

C10.27/C10.30: mobile gallery image reads declare the controlled HTTP route separately from generated SDK services, preserving the encrypted cache lease and denial eviction.
