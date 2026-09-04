# @freeholder/sdk

The ESM client for a Freeholder instance's versioned HTTP service surface.
Create a client with an instance URL and, for protected services, an API key.
Errors are returned as `FreeholderError` values with HTTP status and stable
service error code fields.

The package contains compiled JavaScript and declarations. Its version is kept
in lockstep with the platform and is verified from a packed, clean install.
