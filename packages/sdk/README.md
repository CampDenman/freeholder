# @freeholder/sdk

The ESM client for a Freeholder instance's versioned HTTP service surface.
Create a client with an instance URL and, for protected services, an API key.
`FreeholderClient.call(name, input)` POSTs `/api/v1/<name>`. Errors are
returned as `FreeholderError` values with HTTP status and stable service error
code fields.

Concrete methods generated from the live service registry remain open under
`MASTER.md` C3.03. This package is a generic client, not that generated SDK.

The package contains compiled JavaScript and declarations. Its version is kept
in lockstep with the platform and is verified from a packed, clean install.
