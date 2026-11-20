---
"freeholder": patch
---

When Freeholder refuses to trust what an object store told it, the message now says which check refused. Forty-seven different conditions — an unexpected key, a size that is not a plain number, an ETag in the wrong shape, a listing whose page cursor repeats, a response that omitted a field the request asked for — all reported the same sentence, which named no field, no stage and no provider response. An operator setting up S3-compatible storage got one sentence back and no way to tell a misconfigured bucket from a provider that answers slightly differently from AWS. Each refusal now carries a short fixed label, and an instance that cannot finish starting because of one names it in the startup log too. The label is written in Freeholder's own source and is never a value from the provider: never a key, a URL, a response body or a credential.
